export type ProviderName = 'openai' | 'anthropic' | 'glm' | 'minimax' | 'kimi';

export const PROVIDERS: ProviderName[] = ['openai', 'anthropic', 'glm', 'minimax', 'kimi'];

export const PROVIDER_ENV_VAR: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  glm: 'GLM_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  kimi: 'KIMI_API_KEY',
};

export const PROVIDER_DEFAULT_MODEL: Record<ProviderName, string> = {
  openai: 'gpt-5.3-codex',
  anthropic: 'claude-3-7-sonnet',
  glm: 'glm-5',
  minimax: 'minimax-2.5',
  kimi: 'kimi-k2.5',
};

export const PROVIDER_LOGIN_URL: Record<ProviderName, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  glm: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
  minimax: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  kimi: 'https://platform.moonshot.cn/console/api-keys',
};

export interface ProviderAuthSnapshot {
  provider: ProviderName;
  envVar: string;
  hasEnvKey: boolean;
  hasVaultKey: boolean;
  isAuthenticated: boolean;
}

async function createTUIAuthManager() {
  const authModule = await import('@matrix/auth');
  const authManager = authModule.createAuthManager({
    timeout: 3000,
    retries: 1,
  });
  const vaultPassword = process.env.MATRIX_VAULT_PASSWORD;
  if (vaultPassword) {
    authManager.setVaultPassword(vaultPassword);
  }
  return authManager;
}

export function isProviderName(value: string | undefined): value is ProviderName {
  if (!value) {
    return false;
  }
  return PROVIDERS.includes(value as ProviderName);
}

export function inferProviderFromModel(modelName: string): ProviderName {
  const normalized = modelName.toLowerCase();
  if (normalized.startsWith('glm')) {
    return 'glm';
  }
  if (normalized.startsWith('minimax')) {
    return 'minimax';
  }
  if (normalized.startsWith('kimi')) {
    return 'kimi';
  }
  if (normalized.startsWith('claude')) {
    return 'anthropic';
  }
  return 'openai';
}

export function hasProviderEnvKey(provider: ProviderName): boolean {
  const envVar = PROVIDER_ENV_VAR[provider];
  const raw = process.env[envVar];
  return typeof raw === 'string' && raw.trim().length > 0;
}

export async function getProviderAuthSnapshot(provider: ProviderName): Promise<ProviderAuthSnapshot> {
  const hasEnvKey = hasProviderEnvKey(provider);
  let hasVaultKey = false;

  try {
    const authManager = await createTUIAuthManager();
    const status = await authManager.getStatus();
    hasVaultKey = status.providers.some((entry) => entry.name === provider && entry.hasKey);
  } catch {
    hasVaultKey = false;
  }

  return {
    provider,
    envVar: PROVIDER_ENV_VAR[provider],
    hasEnvKey,
    hasVaultKey,
    isAuthenticated: hasEnvKey || hasVaultKey,
  };
}

export async function setAndPersistProviderKey(provider: ProviderName, apiKey: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    return {
      success: false,
      error: 'API key is empty.',
    };
  }

  try {
    const authManager = await createTUIAuthManager();
    const validation = authManager.validateKey(provider, trimmed);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error ?? 'Invalid API key format.',
      };
    }

    const persisted = await authManager.addProviderKey(provider, trimmed);
    if (!persisted.success) {
      return persisted;
    }

    process.env[PROVIDER_ENV_VAR[provider]] = trimmed;
    return { success: true };
  } catch {
    process.env[PROVIDER_ENV_VAR[provider]] = trimmed;
    return { success: true };
  }
}
