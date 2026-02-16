import { KeyVault, createKeyVault } from './vault/index.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

/**
 * Provider types
 */
export type AuthProvider = 'openai' | 'anthropic' | 'glm' | 'minimax' | 'kimi';

/**
 * Matrix API configuration
 */
export interface MatrixAPIConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
}

/**
 * Default API configuration
 */
const DEFAULT_API_CONFIG: MatrixAPIConfig = {
  baseUrl: 'https://api.matrix.ai',
  timeout: 30000,
  retries: 3,
};

/**
 * Matrix user session
 */
export interface MatrixSession {
  token: string;
  refreshToken: string;
  expiresAt: number;
  user: MatrixUser;
}

/**
 * Matrix user information
 */
export interface MatrixUser {
  id: string;
  email: string;
  name?: string;
  plan: MatrixPlan;
  quota: QuotaInfo;
  createdAt: string;
}

/**
 * Matrix subscription plan
 */
export interface MatrixPlan {
  id: string;
  name: 'free' | 'starter' | 'pro' | 'enterprise';
  limits: {
    tokensPerMonth: number;
    requestsPerDay: number;
    maxContextTokens: number;
    features: string[];
  };
  current: boolean;
}

/**
 * Quota information
 */
export interface QuotaInfo {
  tokensUsed: number;
  tokensLimit: number;
  requestsToday: number;
  requestsLimit: number;
  resetsAt: string;
}

/**
 * Auth status
 */
export interface AuthStatus {
  isLoggedIn: boolean;
  providers: Array<{
    name: string;
    hasKey: boolean;
    keyId?: string;
  }>;
  matrixAccount?: {
    id: string;
    email: string;
    name?: string;
    plan: string;
    quota: QuotaInfo;
  };
  sessionExpiry?: number;
}

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  error?: string;
  requiresMFA?: boolean;
  mfaToken?: string;
}

/**
 * API response wrapper
 */
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Session storage path
 */
const SESSION_FILE = join(homedir(), '.matrix', 'session.json');

/**
 * Auth manager for Matrix CLI with real API integration
 *
 * Implements PRD Section 4.3 and 21.7:
 * - Matrix account login
 * - Plan/entitlement check
 * - Quota tracking
 */
export class AuthManager {
  private vault: KeyVault;
  private session: MatrixSession | null = null;
  private apiConfig: MatrixAPIConfig;
  private sessionCache: Map<string, unknown> = new Map();

  constructor(apiConfig?: Partial<MatrixAPIConfig>) {
    this.vault = createKeyVault();
    this.apiConfig = { ...DEFAULT_API_CONFIG, ...apiConfig };
    this.loadSession();
  }

  /**
   * Load session from disk
   */
  private async loadSession(): Promise<void> {
    try {
      if (existsSync(SESSION_FILE)) {
        const data = await readFile(SESSION_FILE, 'utf-8');
        const session = JSON.parse(data) as MatrixSession;

        // Check if session is still valid
        if (session.expiresAt > Date.now()) {
          this.session = session;
        } else {
          // Try to refresh
          await this.refreshSession(session.refreshToken);
        }
      }
    } catch (error) {
      // Session load failed, user needs to login
      this.session = null;
    }
  }

  /**
   * Save session to disk
   */
  private async saveSession(): Promise<void> {
    if (this.session) {
      const sessionDir = join(homedir(), '.matrix');
      if (!existsSync(sessionDir)) {
        const { mkdir } = await import('fs/promises');
        await mkdir(sessionDir, { recursive: true });
      }
      await writeFile(SESSION_FILE, JSON.stringify(this.session, null, 2));
    }
  }

  /**
   * Login to Matrix
   */
  async login(email: string, password: string, mfaCode?: string): Promise<LoginResult> {
    try {
      const response = await this.apiCall<MatrixSession>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          mfaCode,
          client: 'matrix-cli',
          version: '0.1.0',
        }),
      });

      if (!response.success || !response.data) {
        // Check for MFA requirement
        if (response.error?.code === 'MFA_REQUIRED') {
          return {
            success: false,
            requiresMFA: true,
            mfaToken: response.error.message,
            error: 'MFA code required',
          };
        }

        return {
          success: false,
          error: response.error?.message || 'Login failed',
        };
      }

      this.session = response.data;
      await this.saveSession();

      return { success: true };
    } catch (error) {
      // Fallback to offline/mock mode for development
      if (this.isNetworkError(error)) {
        return this.loginOffline(email, password);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed',
      };
    }
  }

  /**
   * Offline login for development/fallback
   */
  private async loginOffline(email: string, _password: string): Promise<LoginResult> {
    // Create a mock session for offline development
    const displayName = email.split('@')[0];
    const mockSession: MatrixSession = {
      token: this.generateMockToken(email),
      refreshToken: this.generateMockToken(email, 'refresh'),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      user: {
        id: `user_${Date.now()}`,
        email,
        ...(displayName !== undefined ? { name: displayName } : {}),
        plan: {
          id: 'free',
          name: 'free',
          limits: {
            tokensPerMonth: 100000,
            requestsPerDay: 100,
            maxContextTokens: 8000,
            features: ['basic'],
          },
          current: true,
        },
        quota: {
          tokensUsed: 0,
          tokensLimit: 100000,
          requestsToday: 0,
          requestsLimit: 100,
          resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
    };

    this.session = mockSession;
    await this.saveSession();

    console.warn('Warning: Running in offline mode. Some features may be limited.');

    return { success: true };
  }

  /**
   * Logout from Matrix
   */
  async logout(): Promise<void> {
    try {
      if (this.session) {
        // Notify server of logout
        await this.apiCall('/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.session.token}`,
          },
        }).catch(() => {
          // Ignore logout API errors
        });
      }
    } finally {
      this.session = null;
      this.sessionCache.clear();

      // Delete session file
      if (existsSync(SESSION_FILE)) {
        await writeFile(SESSION_FILE, '{}');
      }
    }
  }

  /**
   * Refresh session token
   */
  private async refreshSession(refreshToken: string): Promise<boolean> {
    try {
      const response = await this.apiCall<MatrixSession>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });

      if (response.success && response.data) {
        this.session = response.data;
        await this.saveSession();
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if logged in to Matrix
   */
  isLoggedIn(): boolean {
    return this.session !== null && this.session.expiresAt > Date.now();
  }

  /**
   * Get current session
   */
  getSession(): MatrixSession | null {
    return this.session;
  }

  /**
   * Get current user
   */
  getCurrentUser(): MatrixUser | null {
    return this.session?.user ?? null;
  }

  /**
   * Get user plan
   */
  getPlan(): MatrixPlan | null {
    return this.session?.user.plan ?? null;
  }

  /**
   * Get quota information
   */
  getQuota(): QuotaInfo | null {
    return this.session?.user.quota ?? null;
  }

  /**
   * Check if user has feature access
   */
  hasFeature(feature: string): boolean {
    const plan = this.getPlan();
    if (!plan) return false;
    return plan.limits.features.includes(feature);
  }

  /**
   * Get available plans
   */
  async getPlans(): Promise<MatrixPlan[]> {
    try {
      const response = await this.apiCall<{ plans: MatrixPlan[] }>('/plans');
      if (response.success && response.data) {
        return response.data.plans;
      }
    } catch (error) {
      // Fallback to default plans
    }

    // Default plans for offline mode
    return [
      {
        id: 'free',
        name: 'free',
        limits: {
          tokensPerMonth: 100000,
          requestsPerDay: 100,
          maxContextTokens: 8000,
          features: ['basic'],
        },
        current: this.session?.user.plan.id === 'free',
      },
      {
        id: 'starter',
        name: 'starter',
        limits: {
          tokensPerMonth: 500000,
          requestsPerDay: 500,
          maxContextTokens: 16000,
          features: ['basic', 'priority'],
        },
        current: this.session?.user.plan.id === 'starter',
      },
      {
        id: 'pro',
        name: 'pro',
        limits: {
          tokensPerMonth: 2000000,
          requestsPerDay: 2000,
          maxContextTokens: 32000,
          features: ['basic', 'priority', 'advanced', 'beta'],
        },
        current: this.session?.user.plan.id === 'pro',
      },
    ];
  }

  /**
   * Update quota usage after API call
   */
  async updateQuota(tokensUsed: number): Promise<void> {
    if (this.session) {
      this.session.user.quota.tokensUsed += tokensUsed;
      this.session.user.quota.requestsToday += 1;
      await this.saveSession();
    }
  }

  /**
   * Check quota before operation
   */
  checkQuota(tokensNeeded: number): { allowed: boolean; reason?: string } {
    const quota = this.getQuota();
    if (!quota) {
      return { allowed: true }; // Allow if no quota tracking
    }

    if (quota.tokensUsed + tokensNeeded > quota.tokensLimit) {
      return {
        allowed: false,
        reason: `Token quota exceeded. Used: ${quota.tokensUsed}/${quota.tokensLimit}, Needed: ${tokensNeeded}`,
      };
    }

    if (quota.requestsToday >= quota.requestsLimit) {
      return {
        allowed: false,
        reason: `Daily request limit exceeded. Used: ${quota.requestsToday}/${quota.requestsLimit}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Add a provider API key
   */
  async addProviderKey(provider: AuthProvider, apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.vault.storeKey(provider, apiKey);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store key',
      };
    }
  }

  /**
   * Get a provider API key
   */
  async getProviderKey(provider: AuthProvider): Promise<string | null> {
    return this.vault.getKey(provider);
  }

  /**
   * Remove a provider API key
   */
  async removeProviderKey(provider: AuthProvider): Promise<boolean> {
    return this.vault.deleteKey(provider);
  }

  /**
   * Check if provider has key
   */
  async hasProviderKey(provider: AuthProvider): Promise<boolean> {
    return this.vault.hasKey(provider);
  }

  /**
   * Get auth status
   */
  async getStatus(): Promise<AuthStatus> {
    const providers: AuthStatus['providers'] = [];
    const providerNames: AuthProvider[] = ['openai', 'anthropic', 'glm', 'minimax', 'kimi'];

    for (const provider of providerNames) {
      const hasKey = await this.vault.hasKey(provider);
      providers.push({
        name: provider,
        hasKey,
      });
    }

    const status: AuthStatus = {
      isLoggedIn: this.isLoggedIn(),
      providers,
    };

    if (this.session) {
      status.matrixAccount = {
        id: this.session.user.id,
        email: this.session.user.email,
        plan: this.session.user.plan.name,
        quota: this.session.user.quota,
        ...(this.session.user.name !== undefined ? { name: this.session.user.name } : {}),
      };
      status.sessionExpiry = this.session.expiresAt;
    }

    return status;
  }

  /**
   * Set fallback password for vault
   */
  setVaultPassword(password: string): void {
    this.vault.setFallbackPassword(password);
  }

  /**
   * Validate API key format
   */
  validateKey(provider: AuthProvider, key: string): { valid: boolean; error?: string } {
    switch (provider) {
      case 'openai':
        if (!key.startsWith('sk-')) {
          return { valid: false, error: 'OpenAI API key should start with "sk-"' };
        }
        break;
      case 'anthropic':
        if (!key.startsWith('sk-ant-')) {
          return { valid: false, error: 'Anthropic API key should start with "sk-ant-"' };
        }
        break;
      case 'glm':
        if (!key.startsWith('glm-') && key.length < 20) {
          return { valid: false, error: 'GLM API key format invalid' };
        }
        break;
      case 'minimax':
        if (key.length < 20) {
          return { valid: false, error: 'MiniMax API key seems too short' };
        }
        break;
      case 'kimi':
        if (key.length < 20) {
          return { valid: false, error: 'Kimi API key seems too short' };
        }
        break;
    }

    if (key.length < 20) {
      return { valid: false, error: 'API key seems too short' };
    }

    return { valid: true };
  }

  /**
   * Get authorization header for API calls
   */
  getAuthHeader(): string | null {
    if (!this.session) return null;
    return `Bearer ${this.session.token}`;
  }

  /**
   * Make API call to Matrix server
   */
  private async apiCall<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<APIResponse<T>> {
    const url = `${this.apiConfig.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add auth header if logged in
    const authHeader = this.getAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.apiConfig.timeout);

    try {
      const requestOptions: RequestInit = {
        method: options.method || 'GET',
        headers,
        signal: controller.signal,
        ...(options.body !== undefined ? { body: options.body } : {}),
      };

      const response = await fetch(url, requestOptions);

      clearTimeout(timeoutId);

      const data = await response.json() as unknown;

      if (!response.ok) {
        const errorData = (
          typeof data === 'object' &&
          data !== null &&
          'error' in data
        )
          ? (data as { error?: APIResponse<T>['error'] }).error
          : undefined;

        return {
          success: false,
          error: errorData || {
            code: 'HTTP_ERROR',
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        };
      }

      if (
        typeof data === 'object' &&
        data !== null &&
        'success' in data
      ) {
        return data as APIResponse<T>;
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: 'Request timed out',
          },
        };
      }

      throw error;
    }
  }

  /**
   * Generate mock token for offline mode
   */
  private generateMockToken(email: string, type: string = 'access'): string {
    const payload = {
      sub: email,
      type,
      iat: Date.now(),
      exp: Date.now() + (type === 'refresh' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000),
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  /**
   * Check if error is network-related
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('fetch failed') ||
        message.includes('dns')
      );
    }
    return false;
  }
}

/**
 * Create an AuthManager instance
 */
export function createAuthManager(apiConfig?: Partial<MatrixAPIConfig>): AuthManager {
  return new AuthManager(apiConfig);
}
