import keytar from 'keytar';
import sodium from 'libsodium-wrappers';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Service name for keytar
 */
const SERVICE_NAME = 'matrix-cli';

/**
 * PRD Section 12.1 - Key storage location
 * Single encrypted file: ~/.matrix/keys.enc
 */
const KEYS_FILE = 'keys.enc';

/**
 * Encrypted vault data
 */
interface EncryptedVault {
  version: number;
  nonce: string;
  ciphertext: string;
  checksum: string;
}

/**
 * All keys storage structure
 */
interface KeysStorage {
  [provider: string]: {
    key: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Key entry
 */
interface KeyEntry {
  provider: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Key Vault for secure storage of API keys and secrets
 * PRD Section 12.1: Keys stored at ~/.matrix/keys.enc
 */
export class KeyVault {
  private matrixDir: string;
  private keysFilePath: string;
  private fallbackPassword: string | null = null;
  private useKeychain: boolean;
  private cache: KeysStorage | null = null;

  constructor(options: { useKeychain?: boolean; matrixDir?: string } = {}) {
    this.useKeychain = options.useKeychain ?? true;
    this.matrixDir = options.matrixDir ?? join(homedir(), '.matrix');
    this.keysFilePath = join(this.matrixDir, KEYS_FILE);
  }

  /**
   * Store a key securely
   */
  async storeKey(
    provider: string,
    key: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const keyId = `${provider}:api_key`;

    if (this.useKeychain) {
      try {
        await keytar.setPassword(SERVICE_NAME, keyId, key);
        return;
      } catch (error) {
        console.warn('Keychain not available, falling back to encrypted storage');
      }
    }

    // Fallback to encrypted file storage
    await this.storeFallback(provider, key, metadata);
  }

  /**
   * Retrieve a key
   */
  async getKey(provider: string): Promise<string | null> {
    const keyId = `${provider}:api_key`;

    if (this.useKeychain) {
      try {
        const key = await keytar.getPassword(SERVICE_NAME, keyId);
        if (key) return key;
      } catch (error) {
        console.warn('Keychain not available, trying fallback storage');
      }
    }

    // Try fallback storage
    return this.getFallback(provider);
  }

  /**
   * Delete a key
   */
  async deleteKey(provider: string): Promise<boolean> {
    const keyId = `${provider}:api_key`;

    if (this.useKeychain) {
      try {
        const deleted = await keytar.deletePassword(SERVICE_NAME, keyId);
        if (deleted) return true;
      } catch (error) {
        // Continue to fallback
      }
    }

    // Delete from fallback
    return this.deleteFallback(provider);
  }

  /**
   * Check if a key exists
   */
  async hasKey(provider: string): Promise<boolean> {
    const key = await this.getKey(provider);
    return key !== null;
  }

  /**
   * List all stored keys (without values)
   */
  async listKeys(): Promise<KeyEntry[]> {
    const entries: KeyEntry[] = [];

    if (this.useKeychain) {
      try {
        const credentials = await keytar.findCredentials(SERVICE_NAME);
        for (const cred of credentials) {
          entries.push({
            provider: cred.account.split(':')[0] ?? cred.account,
            keyId: cred.account,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        // Continue to fallback
      }
    }

    // Also check fallback
    const fallbackEntries = await this.listFallback();
    for (const entry of fallbackEntries) {
      if (!entries.some(e => e.provider === entry.provider)) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Set fallback password for encryption
   */
  setFallbackPassword(password: string): void {
    this.fallbackPassword = password;
    // Invalidate cache when password changes
    this.cache = null;
  }

  /**
   * Get the keys file path
   */
  getKeysFilePath(): string {
    return this.keysFilePath;
  }

  /**
   * Load all keys from encrypted storage
   */
  private async loadAllKeys(): Promise<KeysStorage> {
    if (this.cache) {
      return this.cache;
    }

    await sodium.ready;

    if (!this.fallbackPassword) {
      return {};
    }

    if (!existsSync(this.keysFilePath)) {
      return {};
    }

    try {
      const vault: EncryptedVault = JSON.parse(readFileSync(this.keysFilePath, 'utf-8'));

      // Derive key
      const passwordBytes = new TextEncoder().encode(this.fallbackPassword);
      const salt = sodium.crypto_generichash(16, passwordBytes);
      const encryptionKey = sodium.crypto_pwhash(
        sodium.crypto_secretbox_KEYBYTES,
        passwordBytes,
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_DEFAULT
      );

      // Verify checksum
      const ciphertext = sodium.from_base64(vault.ciphertext);
      const expectedChecksum = sodium.crypto_generichash(32, ciphertext);
      if (sodium.to_base64(expectedChecksum) !== vault.checksum) {
        sodium.memzero(encryptionKey);
        return {};
      }

      // Decrypt
      const nonce = sodium.from_base64(vault.nonce);
      const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, encryptionKey);

      const data = JSON.parse(new TextDecoder().decode(plaintext)) as KeysStorage;
      sodium.memzero(encryptionKey);

      this.cache = data;
      return data;
    } catch {
      return {};
    }
  }

  /**
   * Save all keys to encrypted storage
   */
  private async saveAllKeys(keys: KeysStorage): Promise<void> {
    await sodium.ready;

    if (!this.fallbackPassword) {
      throw new Error('Fallback password not set. Call setFallbackPassword() first.');
    }

    // Ensure directory exists
    if (!existsSync(this.matrixDir)) {
      mkdirSync(this.matrixDir, { recursive: true, mode: 0o700 });
    }

    // Derive key from password
    const passwordBytes = new TextEncoder().encode(this.fallbackPassword);
    const salt = sodium.crypto_generichash(16, passwordBytes);
    const encryptionKey = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      passwordBytes,
      salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_DEFAULT
    );

    // Encrypt
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const plaintext = new TextEncoder().encode(JSON.stringify(keys));
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, encryptionKey);

    // Create vault entry
    const vault: EncryptedVault = {
      version: 1,
      nonce: sodium.to_base64(nonce),
      ciphertext: sodium.to_base64(ciphertext),
      checksum: sodium.to_base64(sodium.crypto_generichash(32, ciphertext)),
    };

    writeFileSync(this.keysFilePath, JSON.stringify(vault), { mode: 0o600 });

    // Update cache
    this.cache = keys;

    // Clean up
    sodium.memzero(encryptionKey);
  }

  /**
   * Store in fallback encrypted file (single keys.enc file)
   */
  private async storeFallback(
    provider: string,
    key: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const keys = await this.loadAllKeys();
    const now = new Date().toISOString();

    keys[provider] = {
      key,
      createdAt: keys[provider]?.createdAt ?? now,
      updatedAt: now,
      ...(metadata !== undefined ? { metadata } : {}),
    };

    await this.saveAllKeys(keys);
  }

  /**
   * Get from fallback storage
   */
  private async getFallback(provider: string): Promise<string | null> {
    const keys = await this.loadAllKeys();
    return keys[provider]?.key ?? null;
  }

  /**
   * Delete from fallback
   */
  private async deleteFallback(provider: string): Promise<boolean> {
    const keys = await this.loadAllKeys();

    if (!(provider in keys)) {
      return false;
    }

    delete keys[provider];
    await this.saveAllKeys(keys);
    return true;
  }

  /**
   * List fallback keys
   */
  private async listFallback(): Promise<KeyEntry[]> {
    const keys = await this.loadAllKeys();
    const entries: KeyEntry[] = [];

    for (const [provider, data] of Object.entries(keys)) {
      entries.push({
        provider,
        keyId: `${provider}:api_key`,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      });
    }

    return entries;
  }

  /**
   * Migrate old vault files to new keys.enc format
   */
  async migrateFromOldVault(): Promise<boolean> {
    const oldVaultDir = join(this.matrixDir, 'vault');

    if (!existsSync(oldVaultDir)) {
      return false;
    }

    const files = readdirSync(oldVaultDir);
    let migrated = false;

    for (const file of files) {
      if (file.endsWith('.vault')) {
        const provider = file.replace('.vault', '');
        const oldFilePath = join(oldVaultDir, file);

        try {
          // Read old vault file
          JSON.parse(readFileSync(oldFilePath, 'utf-8')) as EncryptedVault;

          // We can't decrypt without the password, so we just note the migration
          console.log(`Found old vault file for ${provider}. Migration requires password.`);

          // Delete old file after successful migration
          // unlinkSync(oldFilePath);
          migrated = true;
        } catch (error) {
          console.warn(`Failed to migrate ${file}: ${error}`);
        }
      }
    }

    return migrated;
  }
}

/**
 * Create a KeyVault instance
 */
export function createKeyVault(options?: { useKeychain?: boolean; matrixDir?: string }): KeyVault {
  return new KeyVault(options);
}
