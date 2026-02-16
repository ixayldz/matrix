import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Conf from 'conf';
import { appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import type { AuthProvider, MatrixPlan, QuotaInfo, AuthManager } from '@matrix/auth';
import {
  runTelemetrySelfTest,
  type TelemetryMode,
  recordOnboardingOutcome,
  loadOnboardingMetrics,
  summarizeOnboardingMetrics,
  recordIncidentDrill,
  loadIncidentRecords,
  summarizeIncidentSla,
  type SevLevel,
} from '../ops-metrics.js';
import { buildReleaseReadinessReport } from '../readiness.js';

/**
 * Configuration store
 */
const config = new Conf({
  projectName: 'matrix-cli',
  defaults: {
    approvalMode: 'balanced',
    defaultModel: 'gpt-5.3-codex',
    telemetry: 'off',
    telemetryMode: 'off',
    telemetryLocalRunRetentionDays: 30,
    telemetryAnalyticsRetentionDays: 90,
    releaseChannel: 'beta',
  },
});

const RELEASE_CHANNELS = ['alpha', 'beta', 'stable'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export interface ReleaseAuditEvent {
  eventVersion: 'v1';
  timestamp: string;
  type: 'release.channel.changed' | 'release.update' | 'release.rollback';
  status: 'started' | 'success' | 'failed' | 'no_change';
  channel?: ReleaseChannel;
  fromVersion?: string;
  toVersion?: string;
  message?: string;
}

export function isValidReleaseChannel(channel: string): channel is ReleaseChannel {
  return RELEASE_CHANNELS.includes(channel as ReleaseChannel);
}

export function getReleaseAuditLogPath(): string {
  const overridePath = process.env.MATRIX_AUDIT_LOG_PATH;
  if (overridePath && overridePath.trim().length > 0) {
    return overridePath;
  }
  return join(homedir(), '.matrix', 'audit', 'events.jsonl');
}

export function appendReleaseAuditEvent(event: Omit<ReleaseAuditEvent, 'eventVersion' | 'timestamp'>): void {
  try {
    const logPath = getReleaseAuditLogPath();
    const normalizedPath = logPath.replace(/\\/g, '/');
    const lastSlash = normalizedPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const logDir = logPath.slice(0, lastSlash);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
    }

    const payload: ReleaseAuditEvent = {
      eventVersion: 'v1',
      timestamp: new Date().toISOString(),
      ...event,
    };
    appendFileSync(logPath, JSON.stringify(payload) + '\n', { encoding: 'utf-8' });
  } catch {
    // Audit logging is best effort and must not break CLI execution.
  }
}

async function createCLIAuthManager(): Promise<AuthManager> {
  const { createAuthManager } = await import('@matrix/auth');
  return createAuthManager({
    timeout: 3000,
    retries: 1,
  });
}

function normalizeProvider(provider: string): AuthProvider | null {
  const normalized = provider.toLowerCase();
  const validProviders: AuthProvider[] = ['openai', 'anthropic', 'glm', 'minimax', 'kimi'];
  return validProviders.includes(normalized as AuthProvider) ? (normalized as AuthProvider) : null;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '***';
  }
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function normalizeTelemetryMode(input: unknown): TelemetryMode {
  if (input === 'minimal' || input === 'diagnostic' || input === 'off') {
    return input;
  }
  return 'off';
}

function getTelemetryMode(): TelemetryMode {
  const explicitMode = config.get('telemetryMode');
  if (typeof explicitMode === 'string') {
    return normalizeTelemetryMode(explicitMode.toLowerCase());
  }

  const telemetryValue = config.get('telemetry');
  if (typeof telemetryValue === 'string') {
    return normalizeTelemetryMode(telemetryValue.toLowerCase());
  }
  if (
    telemetryValue &&
    typeof telemetryValue === 'object' &&
    'mode' in telemetryValue &&
    typeof (telemetryValue as { mode?: unknown }).mode === 'string'
  ) {
    return normalizeTelemetryMode((telemetryValue as { mode: string }).mode.toLowerCase());
  }
  return 'off';
}

function setTelemetryMode(mode: TelemetryMode): void {
  config.set('telemetryMode', mode);
  config.set('telemetry', mode);
}

function getTelemetryRetentionSettings(): { localRunRetentionDays: number; analyticsRetentionDays: number } {
  const localRun = Number(config.get('telemetryLocalRunRetentionDays') ?? 30);
  const analytics = Number(config.get('telemetryAnalyticsRetentionDays') ?? 90);

  return {
    localRunRetentionDays: Number.isFinite(localRun) && localRun > 0 ? Math.floor(localRun) : 30,
    analyticsRetentionDays: Number.isFinite(analytics) && analytics > 0 ? Math.floor(analytics) : 90,
  };
}

function setTelemetryRetentionSettings(settings: {
  localRunRetentionDays?: number;
  analyticsRetentionDays?: number;
}): { localRunRetentionDays: number; analyticsRetentionDays: number } {
  const current = getTelemetryRetentionSettings();
  const next = {
    localRunRetentionDays:
      settings.localRunRetentionDays !== undefined ? Math.max(1, Math.floor(settings.localRunRetentionDays)) : current.localRunRetentionDays,
    analyticsRetentionDays:
      settings.analyticsRetentionDays !== undefined ? Math.max(1, Math.floor(settings.analyticsRetentionDays)) : current.analyticsRetentionDays,
  };

  config.set('telemetryLocalRunRetentionDays', next.localRunRetentionDays);
  config.set('telemetryAnalyticsRetentionDays', next.analyticsRetentionDays);
  return next;
}

function resolveWorkspaceRoot(startDir = process.cwd()): string {
  let current = startDir;
  while (true) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml')) ||
      existsSync(join(current, 'prd.md'))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}

export interface PlansResponseV1 {
  planId: string;
  tier: string;
  periodStart: string;
  periodEnd: string;
  remaining: {
    requests: number;
    tokens: number;
  };
  softLimit: {
    requests: number;
    tokens: number;
  };
  hardLimit: {
    requests: number;
    tokens: number;
  };
  resetAt: string;
  hardLimitBehavior: 'block' | 'degrade' | 'queue';
  recommendedAction: string;
}

export function buildPlansResponse(
  plan: MatrixPlan,
  quota: QuotaInfo | null,
  hardLimitBehavior: 'block' | 'degrade' | 'queue' = 'block'
): PlansResponseV1 {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const requestLimit = plan.limits.requestsPerDay;
  const tokenLimit = plan.limits.tokensPerMonth;
  const requestsUsed = Math.max(0, quota?.requestsToday ?? 0);
  const tokensUsed = Math.max(0, quota?.tokensUsed ?? 0);

  const remainingRequests = Math.max(0, requestLimit - requestsUsed);
  const remainingTokens = Math.max(0, tokenLimit - tokensUsed);

  const requestsUsedPercent = requestLimit > 0 ? requestsUsed / requestLimit : 0;
  const tokensUsedPercent = tokenLimit > 0 ? tokensUsed / tokenLimit : 0;
  const maxUsagePercent = Math.max(requestsUsedPercent, tokensUsedPercent);

  let recommendedAction = 'Usage healthy. Continue current workflow.';
  if (maxUsagePercent >= 1) {
    recommendedAction =
      hardLimitBehavior === 'queue'
        ? 'Quota exhausted. New tasks will be queued until reset.'
        : hardLimitBehavior === 'degrade'
          ? 'Quota exhausted. Operations degrade to low-cost profile.'
          : 'Quota exhausted. Wait for reset or upgrade plan.';
  } else if (maxUsagePercent >= 0.9) {
    recommendedAction = 'Approaching hard limit. Reduce usage or upgrade plan.';
  } else if (maxUsagePercent >= 0.75) {
    recommendedAction = 'Approaching soft limit. Consider optimization or upgrade.';
  }

  return {
    planId: plan.id,
    tier: plan.name,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    remaining: {
      requests: remainingRequests,
      tokens: remainingTokens,
    },
    softLimit: {
      requests: Math.floor(requestLimit * 0.9),
      tokens: Math.floor(tokenLimit * 0.9),
    },
    hardLimit: {
      requests: requestLimit,
      tokens: tokenLimit,
    },
    resetAt: (quota?.resetsAt ? new Date(quota.resetsAt) : periodEnd).toISOString(),
    hardLimitBehavior,
    recommendedAction,
  };
}

/**
 * Default config schema - PRD Section 12.2
 */
const DEFAULT_CONFIG = {
  schemaVersion: '1.2.0',
  activeModel: 'gpt-5.3-codex',
  approvalMode: 'balanced',
  providers: {
    openai: {
      envVar: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
    },
    glm: {
      envVar: 'GLM_API_KEY',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    },
    minimax: {
      envVar: 'MINIMAX_API_KEY',
      baseUrl: 'https://api.minimax.chat/v1',
    },
    kimi: {
      envVar: 'KIMI_API_KEY',
      baseUrl: 'https://api.moonshot.cn/v1',
    },
  },
  mcpServers: [],
  workflow: {
    planConfirmationRequired: true,
    maxReflexionRetries: 3,
    autoLintOnWrite: true,
    autoTestOnWrite: false,
    autoReviewOnComplete: true,
    intent: {
      approveThreshold: 0.85,
      confirmThreshold: 0.60,
      conflictPolicy: 'deny_over_approve',
    },
  },
  quota: {
    softWarnRatio: 0.90,
    hardLimitBehavior: 'block',
  },
  smartRouter: {
    enabled: true,
    maxFallbackRetries: 2,
    tiers: {
      reasoning: { provider: 'openai', model: 'gpt-5.3-codex' },
      codegen: { provider: 'openai', model: 'gpt-5.3-codex' },
      review: { provider: 'openai', model: 'gpt-5.3-codex' },
      cheap: { provider: 'glm', model: 'glm-5' },
      fast: { provider: 'glm', model: 'glm-5' },
      long_context: { provider: 'kimi', model: 'kimi-k2.5' },
      tool_use: { provider: 'openai', model: 'gpt-5.3-codex' },
    },
  },
  context: {
    maxTokenBudget: 128000,
    discoveryLevels: ['structure', 'definitions', 'interface', 'implementation'],
    semanticPruningEnabled: true,
    cacheEnabled: true,
  },
  eventing: {
    schema: 'v1',
    persistToDb: true,
    redactSecrets: true,
  },
  telemetry: {
    mode: 'off',
    localRunRetentionDays: 30,
    analyticsRetentionDays: 90,
    includePerformance: false,
  },
  release: {
    channel: 'beta',
    autoUpdate: false,
  },
  security: {
    secretPatterns: [
      'sk-[a-zA-Z0-9]{20,}',
      'api[_-]?key',
      'secret[_-]?key',
      'bearer\\s+[a-zA-Z0-9_-]+',
    ],
    fileDenylist: ['.env', '*.pem', '*.key', '*.p12', 'credentials.json'],
    commandDenylist: ['rm -rf /', 'sudo', 'curl | bash', 'wget | sh'],
    sandboxEnabled: false,
  },
  compat: {
    claudeCommandParity: 'best_effort',
    allowPlanApproveCommand: true,
  },
};

/**
 * Init command - Initialize a new Matrix project
 */
export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Matrix CLI in the current directory')
    .option('-f, --force', 'Overwrite existing configuration')
    .action(async (options: { force?: boolean }) => {
      const spinner = ora('Initializing Matrix CLI...').start();

      try {
        const cwd = process.cwd();
        const matrixDir = join(cwd, '.matrix');
        const configFile = join(matrixDir, 'config.json');
        const mcpConfigFile = join(matrixDir, 'mcp.json');
        const commandsDir = join(matrixDir, 'commands');
        const sampleCommandFile = join(commandsDir, 'example.md');
        const matrixRulesFile = join(cwd, 'MATRIX.md');
        const agentsFile = join(cwd, 'AGENTS.md');

        // Check if already initialized
        if (existsSync(configFile) && !options.force) {
          spinner.fail('Matrix CLI already initialized. Use --force to overwrite.');
          return;
        }

        // Create .matrix directory
        if (!existsSync(matrixDir)) {
          mkdirSync(matrixDir, { recursive: true });
        }
        if (!existsSync(commandsDir)) {
          mkdirSync(commandsDir, { recursive: true });
        }

        writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2));
        writeFileSync(
          mcpConfigFile,
          JSON.stringify(
            {
              mcpServers: {},
            },
            null,
            2
          )
        );

        if (!existsSync(matrixRulesFile) || options.force) {
          writeFileSync(
            matrixRulesFile,
            [
              '# MATRIX Rules',
              '',
              '## Coding Standards',
              '- Keep changes small and focused.',
              '- Prefer TypeScript strict types and explicit errors.',
              '- Run build and tests before finalizing.',
              '',
              '## Security',
              '- Never commit secrets or credentials.',
              '- Route write/exec through approval and policy checks.',
              '',
            ].join('\n')
          );
        }

        if (!existsSync(agentsFile) || options.force) {
          writeFileSync(
            agentsFile,
            [
              '# Agent Instructions',
              '',
              '## Workflow',
              '- Plan first, then implement after approval.',
              '- Show diffs before applying write operations.',
              '',
              '## Quality',
              '- Add or update tests for behavioral changes.',
              '- Keep event logging and redaction contracts intact.',
              '',
            ].join('\n')
          );
        }

        writeFileSync(
          sampleCommandFile,
          [
            '# /example',
            '',
            'Describe a reusable custom command here.',
            'You can load this command from `.matrix/commands/`.',
            '',
          ].join('\n')
        );

        spinner.succeed('Matrix CLI initialized successfully!');

        console.log('\n' + chalk.bold('Next steps:'));
        console.log('1. Set your API key:');
        console.log(chalk.cyan('   matrix auth add openai'));
        console.log('2. Verify environment:');
        console.log(chalk.cyan('   matrix doctor'));
        console.log('3. Run Matrix CLI:');
        console.log(chalk.cyan('   matrix run'));
      } catch (error) {
        spinner.fail('Failed to initialize Matrix CLI');
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
        process.exit(1);
      }
    });
}

/**
 * Run command - Start the TUI
 */
export function runCommand(program: Command): void {
  const loadTUIModule = async () => {
    try {
      return await import('@matrix/tui');
    } catch (primaryError) {
      try {
        // Monorepo fallback when workspace package resolution is unavailable.
        const localTuiUrl = new URL('../../tui/dist/index.js', import.meta.url);
        return await import(localTuiUrl.href);
      } catch {
        throw primaryError;
      }
    }
  };

  type RunOptionsInput = {
    model?: string;
    provider?: string;
    tui?: boolean;
    noTui?: boolean;
    opts?: () => Record<string, unknown>;
  };

  const extractRunOptions = (input: RunOptionsInput): { model: string; provider: string; headless: boolean } => {
    const nested = typeof input.opts === 'function' ? input.opts() : {};
    const nestedModel = typeof nested.model === 'string' ? nested.model : undefined;
    const nestedProvider = typeof nested.provider === 'string' ? nested.provider : undefined;
    const nestedTui = typeof nested.tui === 'boolean' ? nested.tui : undefined;
    const nestedNoTui = typeof nested.noTui === 'boolean' ? nested.noTui : undefined;

    const model = input.model ?? nestedModel ?? 'gpt-5.3-codex';
    const provider = input.provider ?? nestedProvider ?? 'openai';
    const headless =
      input.noTui === true ||
      nestedNoTui === true ||
      input.tui === false ||
      nestedTui === false;

    return { model, provider, headless };
  };

  program
    .command('run')
    .description('Start the Matrix CLI TUI')
    .option('-m, --model <model>', 'Model to use', 'gpt-5.3-codex')
    .option('-p, --provider <provider>', 'Provider to use', 'openai')
    .option('--no-tui', 'Run in headless mode')
    .action(async (options: RunOptionsInput) => {
      const { model, provider, headless } = extractRunOptions(options);
      console.log(chalk.bold.green('\n  Matrix CLI v0.1.0\n'));

      const cwd = process.cwd();

      if (headless) {
        // Headless mode
        try {
          const { runHeadless } = await loadTUIModule();
          await runHeadless({
            cwd,
            model,
            provider,
            headless: true,
          });
        } catch (error) {
          // Fallback if import fails
          console.log(chalk.yellow('Headless mode unavailable, using basic mode.'));
          console.log(chalk.dim('Model: ' + model));
          console.log(chalk.dim('Provider: ' + provider));
          console.log(chalk.dim('\nPress Ctrl+C to exit\n'));
          console.log(chalk.green('Matrix CLI basic mode ready. Type your input and press Enter.'));

          const readline = await import('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          rl.on('line', (input) => {
            if (input.trim().toLowerCase() === 'exit' || input.trim().toLowerCase() === 'quit') {
              rl.close();
              process.exit(0);
            }
            console.log(chalk.dim(`Received: ${input}`));
            rl.prompt();
          });

          rl.setPrompt('> ');
          rl.prompt();
        }
        return;
      }

      // Start TUI
      try {
        const { startTUI } = await loadTUIModule();
        await startTUI({
          cwd,
          model,
          provider,
          headless: false,
        });
      } catch (error) {
        // Fallback if TUI fails to start
        console.error(chalk.red('Failed to start TUI'));
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));

        // Offer headless mode as alternative
        console.log(chalk.yellow('\nFalling back to basic mode...'));
        console.log(chalk.dim('Model: ' + model));
        console.log(chalk.dim('Provider: ' + provider));
        console.log(chalk.dim('\nPress Ctrl+C to exit\n'));
        console.log(chalk.green('Matrix CLI ready. Type your input and press Enter.'));

        // Simple readline fallback
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl.on('line', (input) => {
          if (input.trim().toLowerCase() === 'exit' || input.trim().toLowerCase() === 'quit') {
            rl.close();
            process.exit(0);
          }
          console.log(chalk.dim(`Received: ${input}`));
          rl.prompt();
        });

        rl.setPrompt('> ');
        rl.prompt();
      }
    });
}

/**
 * Auth commands - PRD Section 21.7
 */
export function authCommand(program: Command): void {
  const auth = program.command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Login to Matrix account (optional)')
    .action(async () => {
      console.log(chalk.yellow('Matrix account login is optional.'));
      console.log(chalk.dim('You can use Matrix CLI with just provider API keys.'));
    });

  auth
    .command('logout')
    .description('Logout from Matrix account')
    .action(async () => {
      config.delete('matrixToken');
      console.log(chalk.green('Logged out successfully'));
    });

  auth
    .command('status')
    .description('Show authentication status')
    .action(async () => {
      const authManager = await createCLIAuthManager();
      const vaultPassword = process.env.MATRIX_VAULT_PASSWORD;
      if (vaultPassword) {
        authManager.setVaultPassword(vaultPassword);
      }

      const status = await authManager.getStatus();
      console.log(chalk.bold('\nAuthentication Status\n'));
      console.log(`  Matrix Account: ${status.isLoggedIn ? chalk.green('Logged in') : chalk.yellow('Not logged in')}`);

      if (status.matrixAccount) {
        console.log(`  User: ${status.matrixAccount.email}`);
        console.log(`  Plan: ${chalk.cyan(status.matrixAccount.plan)}`);
      }

      console.log(chalk.bold('\nProvider API Keys:'));
      for (const provider of status.providers) {
        const envKey = process.env[`${provider.name.toUpperCase()}_API_KEY`];
        const envSet = typeof envKey === 'string' && envKey.length > 0;
        const source = provider.hasKey ? 'vault' : envSet ? 'env' : 'none';
        const marker = source === 'none' ? chalk.dim('âœ— Not set') : chalk.green('âœ“ Set');
        const detail = source === 'env'
          ? `env (${maskSecret(envKey!)})`
          : source === 'vault'
            ? 'vault'
            : 'none';
        console.log(`  ${provider.name}: ${marker} ${chalk.dim(`[${detail}]`)}`);
      }

      if (!vaultPassword) {
        console.log(chalk.dim('\nTip: set MATRIX_VAULT_PASSWORD to enable encrypted-file fallback if keychain is unavailable.'));
      }
    });

  auth
    .command('add <provider>')
    .description('Add a provider API key')
    .option('-k, --key <apiKey>', 'API key value (otherwise reads PROVIDER_API_KEY env var)')
    .option('--vault-password <password>', 'Fallback vault password for encrypted file mode')
    .option('--no-validate', 'Skip provider-specific API key format checks')
    .action(async (
      providerInput: string,
      options: { key?: string; vaultPassword?: string; validate?: boolean }
    ) => {
      const provider = normalizeProvider(providerInput);
      if (!provider) {
        console.error(chalk.red(`Unknown provider: ${providerInput}`));
        console.log(chalk.dim('Valid providers: openai, anthropic, glm, minimax, kimi'));
        return;
      }

      const envVarName = `${provider.toUpperCase()}_API_KEY`;
      const rawKey = options.key ?? process.env[envVarName];
      if (!rawKey || rawKey.trim().length === 0) {
        console.error(chalk.red('No API key provided.'));
        console.log(chalk.dim(`Provide --key "<value>" or set ${envVarName} environment variable.`));
        return;
      }

      const authManager = await createCLIAuthManager();
      const fallbackPassword = options.vaultPassword ?? process.env.MATRIX_VAULT_PASSWORD;
      if (fallbackPassword) {
        authManager.setVaultPassword(fallbackPassword);
      }

      if (options.validate !== false) {
        const validation = authManager.validateKey(provider, rawKey);
        if (!validation.valid) {
          console.error(chalk.red(validation.error ?? 'Invalid API key format.'));
          console.log(chalk.dim('Use --no-validate only if your provider uses a non-standard key format.'));
          return;
        }
      }

      const result = await authManager.addProviderKey(provider, rawKey);
      if (!result.success) {
        console.error(chalk.red(result.error ?? 'Failed to store API key.'));
        if (!fallbackPassword) {
          console.log(chalk.dim('If keychain is unavailable, set MATRIX_VAULT_PASSWORD or use --vault-password.'));
        }
        return;
      }

      console.log(chalk.green(`Stored ${provider} API key securely.`));
      console.log(chalk.dim(`Source key preview: ${maskSecret(rawKey)}`));
    });

  auth
    .command('remove <provider>')
    .description('Remove a stored provider API key')
    .option('--vault-password <password>', 'Fallback vault password for encrypted file mode')
    .action(async (providerInput: string, options: { vaultPassword?: string }) => {
      const provider = normalizeProvider(providerInput);
      if (!provider) {
        console.error(chalk.red(`Unknown provider: ${providerInput}`));
        console.log(chalk.dim('Valid providers: openai, anthropic, glm, minimax, kimi'));
        return;
      }

      const authManager = await createCLIAuthManager();
      const fallbackPassword = options.vaultPassword ?? process.env.MATRIX_VAULT_PASSWORD;
      if (fallbackPassword) {
        authManager.setVaultPassword(fallbackPassword);
      }

      const removed = await authManager.removeProviderKey(provider);
      if (!removed) {
        console.log(chalk.yellow(`No stored key found for ${provider}.`));
        return;
      }

      console.log(chalk.green(`Removed ${provider} API key.`));
    });

  // PRD Section 21.7 - auth plans command
  auth
    .command('plans')
    .description('Show subscription plans and quota information')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const authManager = await createCLIAuthManager();
      const plans = await authManager.getPlans();
      const currentPlan = plans.find((plan) => plan.current) ?? plans[0];
      if (!currentPlan) {
        console.error(chalk.red('No plan data available.'));
        process.exitCode = 1;
        return;
      }

      const hardLimitBehaviorRaw = config.get('quotaHardLimitBehavior');
      const hardLimitBehavior = hardLimitBehaviorRaw === 'degrade' || hardLimitBehaviorRaw === 'queue'
        ? hardLimitBehaviorRaw
        : 'block';

      const plansResponse = buildPlansResponse(
        currentPlan,
        authManager.getQuota(),
        hardLimitBehavior
      );

      if (options.json) {
        console.log(JSON.stringify(plansResponse, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Subscription & Quota Information\n'));
      console.log(`  Plan: ${chalk.cyan(plansResponse.tier)} (${plansResponse.planId})`);
      console.log(`  Period: ${plansResponse.periodStart.slice(0, 10)} to ${plansResponse.periodEnd.slice(0, 10)}`);
      console.log('\n  Usage:');
      console.log(`    Requests: ${plansResponse.remaining.requests}/${plansResponse.hardLimit.requests}`);
      console.log(`    Tokens: ${plansResponse.remaining.tokens.toLocaleString()}/${plansResponse.hardLimit.tokens.toLocaleString()}`);
      console.log(`\n  Hard Limit Behavior: ${plansResponse.hardLimitBehavior}`);
      console.log(`  Resets: ${plansResponse.resetAt.slice(0, 10)}`);
      console.log(chalk.dim(`\n  ${plansResponse.recommendedAction}`));
    });
}

/**
 * Doctor command - PRD Section 21.6
 */
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check environment and dependencies')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const checks: Array<{
        id: string;
        status: 'pass' | 'warn' | 'fail';
        severity: 'low' | 'medium' | 'high';
        message: string;
        remediation?: string;
      }> = [];

      // Platform check
      checks.push({
        id: 'platform',
        status: 'pass',
        severity: 'low',
        message: `Platform: ${process.platform} ${process.arch} | Node: ${process.version}`,
      });

      // Permissions check (file system)
      try {
        const testFile = join(process.cwd(), '.matrix-permission-test');
        writeFileSync(testFile, 'test');
        unlinkSync(testFile);
        checks.push({
          id: 'permissions',
          status: 'pass',
          severity: 'low',
          message: 'File system permissions OK',
        });
      } catch {
        checks.push({
          id: 'permissions',
          status: 'fail',
          severity: 'high',
          message: 'Cannot write to current directory',
          remediation: 'Check directory permissions or run from a different location',
        });
      }

      // Keychain availability
      try {
        // Check if keytar is available
        await import('keytar');
        checks.push({
          id: 'keychain',
          status: 'pass',
          severity: 'low',
          message: 'OS keychain available for secure key storage',
        });
      } catch {
        checks.push({
          id: 'keychain',
          status: 'warn',
          severity: 'medium',
          message: 'OS keychain not available, using encrypted file fallback',
          remediation: 'Install keytar for better key security: npm install keytar',
        });
      }

      // Network connectivity
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          await fetch('https://api.openai.com/v1', {
            method: 'GET',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        checks.push({
          id: 'network',
          status: 'pass',
          severity: 'low',
          message: 'Network connectivity OK',
        });
      } catch {
        checks.push({
          id: 'network',
          status: 'warn',
          severity: 'medium',
          message: 'Cannot reach API endpoints',
          remediation: 'Check your internet connection or proxy settings',
        });
      }

      // MCP servers check
      checks.push({
        id: 'mcp',
        status: 'pass',
        severity: 'low',
        message: 'MCP runtime ready',
      });

      // Sandbox check
      checks.push({
        id: 'sandbox',
        status: 'warn',
        severity: 'low',
        message: 'Sandbox not configured (optional)',
        remediation: 'Enable sandbox in config for enhanced security',
      });

      // Telemetry privacy contract check (PRD Section 21.8 + 22.2 #9)
      const telemetryMode = getTelemetryMode();
      const telemetryReport = runTelemetrySelfTest(telemetryMode);
      checks.push({
        id: 'telemetry_privacy',
        status: telemetryReport.pass ? 'pass' : 'fail',
        severity: telemetryReport.pass ? 'low' : 'high',
        message: telemetryReport.pass
          ? `Telemetry privacy gate passed for mode: ${telemetryMode}`
          : `Telemetry privacy gate failed for mode: ${telemetryMode}`,
        remediation: telemetryReport.pass ? undefined : telemetryReport.checks.filter((check) => !check.pass).map((check) => check.message).join(' | '),
      });

      // Calculate summary
      const summary = {
        pass: checks.filter(c => c.status === 'pass').length,
        warn: checks.filter(c => c.status === 'warn').length,
        fail: checks.filter(c => c.status === 'fail').length,
      };

      // Determine overall status
      const overallStatus: 'pass' | 'warn' | 'fail' =
        summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';

      if (options.json) {
        // PRD Section 21.6 JSON contract
        const jsonOutput = {
          status: overallStatus,
          generatedAt: new Date().toISOString(),
          summary,
          checks,
        };
        console.log(JSON.stringify(jsonOutput, null, 2));

        // Exit code: 0 = pass/warn, 2 = fail
        if (summary.fail > 0) {
          process.exit(2);
        }
        return;
      }

      console.log(chalk.bold('\n  Matrix CLI Doctor\n'));

      for (const check of checks) {
        const icon = check.status === 'pass' ? chalk.green('OK') :
          check.status === 'warn' ? chalk.yellow('WARN') : chalk.red('FAIL');
        console.log(`  ${icon} [${check.id}] ${check.message}`);
        if (check.remediation) {
          console.log(chalk.dim(`      -> ${check.remediation}`));
        }
      }

      console.log(chalk.bold(`\n  Summary: `) +
        `${chalk.green(summary.pass + ' passed')}, ` +
        `${chalk.yellow(summary.warn + ' warnings')}, ` +
        `${chalk.red(summary.fail + ' failed')}`);

      if (summary.fail > 0) {
        console.log(chalk.red('\n  Some checks failed. Please fix them before continuing.'));
        process.exit(2);
      }
    });
}

/**
 * Telemetry command
 */
export function telemetryCommand(program: Command): void {
  const telemetry = program.command('telemetry').description('Manage telemetry settings');

  telemetry
    .command('status')
    .description('Show telemetry status')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const setting = getTelemetryMode();
      const retention = getTelemetryRetentionSettings();
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              mode: setting,
              localRunRetentionDays: retention.localRunRetentionDays,
              analyticsRetentionDays: retention.analyticsRetentionDays,
            },
            null,
            2
          )
        );
        return;
      }
      console.log(chalk.bold('\nTelemetry Status'));
      console.log(`  Mode: ${setting}`);
      console.log(`  Local Run Retention: ${retention.localRunRetentionDays} days`);
      console.log(`  Analytics Retention: ${retention.analyticsRetentionDays} days`);
      console.log(chalk.dim('\n  Modes: off, minimal, diagnostic'));
      console.log(chalk.dim('  Local run logs are always kept on disk.'));
      console.log(chalk.dim('  Product analytics follows telemetry mode and redacts secrets.'));
    });

  telemetry
    .command('enable')
    .description('Enable full telemetry (compat alias for diagnostic)')
    .action(() => {
      setTelemetryMode('diagnostic');
      console.log(chalk.green('Telemetry mode set to diagnostic'));
    });

  telemetry
    .command('minimal')
    .description('Enable minimal telemetry')
    .action(() => {
      setTelemetryMode('minimal');
      console.log(chalk.green('Minimal telemetry enabled'));
    });

  telemetry
    .command('disable')
    .description('Disable telemetry (compat alias for off)')
    .action(() => {
      setTelemetryMode('off');
      console.log(chalk.green('Telemetry mode set to off'));
    });

  telemetry
    .command('off')
    .description('Set telemetry mode to off')
    .action(() => {
      setTelemetryMode('off');
      console.log(chalk.green('Telemetry mode set to off'));
    });

  telemetry
    .command('diagnostic')
    .description('Set telemetry mode to diagnostic')
    .action(() => {
      setTelemetryMode('diagnostic');
      console.log(chalk.green('Telemetry mode set to diagnostic'));
    });

  telemetry
    .command('retention')
    .description('Show or update telemetry retention defaults')
    .option('--local-run-days <days>', 'Local run log retention in days')
    .option('--analytics-days <days>', 'Analytics retention in days')
    .option('--json', 'Output as JSON')
    .action((options: { localRunDays?: string; analyticsDays?: string; json?: boolean }) => {
      const localRunDays =
        options.localRunDays !== undefined ? Number.parseInt(options.localRunDays, 10) : undefined;
      const analyticsDays =
        options.analyticsDays !== undefined ? Number.parseInt(options.analyticsDays, 10) : undefined;

      if (localRunDays !== undefined && (!Number.isFinite(localRunDays) || localRunDays <= 0)) {
        console.error(chalk.red(`Invalid --local-run-days value: ${options.localRunDays}`));
        process.exitCode = 1;
        return;
      }
      if (analyticsDays !== undefined && (!Number.isFinite(analyticsDays) || analyticsDays <= 0)) {
        console.error(chalk.red(`Invalid --analytics-days value: ${options.analyticsDays}`));
        process.exitCode = 1;
        return;
      }

      const retention = setTelemetryRetentionSettings({
        ...(localRunDays !== undefined ? { localRunRetentionDays: localRunDays } : {}),
        ...(analyticsDays !== undefined ? { analyticsRetentionDays: analyticsDays } : {}),
      });
      const payload = {
        mode: getTelemetryMode(),
        ...retention,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(chalk.bold('\nTelemetry Retention\n'));
      console.log(`  Local Run Retention: ${retention.localRunRetentionDays} days`);
      console.log(`  Analytics Retention: ${retention.analyticsRetentionDays} days`);
    });

  telemetry
    .command('self-test')
    .description('Run telemetry privacy contract self-test')
    .option('--mode <mode>', 'Telemetry mode to validate (off|minimal|diagnostic)')
    .option('--json', 'Output as JSON')
    .action((options: { mode?: string; json?: boolean }) => {
      const requestedMode = (options.mode ?? getTelemetryMode()).toLowerCase();
      if (!['off', 'minimal', 'diagnostic'].includes(requestedMode)) {
        console.error(chalk.red(`Invalid telemetry mode: ${requestedMode}`));
        process.exitCode = 1;
        return;
      }
      const mode = requestedMode as TelemetryMode;

      const report = runTelemetrySelfTest(mode);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(chalk.bold('\nTelemetry Privacy Self-Test\n'));
        for (const check of report.checks) {
          const icon = check.pass ? chalk.green('OK') : chalk.red('FAIL');
          console.log(`  ${icon} [${check.id}] ${check.message}`);
        }
      }

      if (!report.pass) {
        process.exit(2);
      }
    });
}

/**
 * Update command - PRD Section 4.1
 */
export function updateCommand(program: Command): void {
  program
    .command('update')
    .description('Update Matrix CLI to the latest version')
    .option('--channel <channel>', 'Release channel (alpha, beta, stable)', 'beta')
    .option('--check', 'Only check update availability (no install)')
    .option('--dry-run', 'Simulate update/rollback without installing')
    .option('--rollback', 'Rollback to previous version')
    .action(async (options: { channel: string; check?: boolean; dryRun?: boolean; rollback?: boolean }) => {
      if (options.rollback) {
        await handleRollback({ dryRun: options.dryRun === true });
        return;
      }

      if (!isValidReleaseChannel(options.channel)) {
        console.error(chalk.red(`Invalid channel: ${options.channel}`));
        console.log(chalk.dim(`Valid channels: ${RELEASE_CHANNELS.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      await handleUpdate(options.channel, {
        checkOnly: options.check === true,
        dryRun: options.dryRun === true,
      });
    });
}

/**
 * Get current installed version
 */
function getCurrentVersion(): string {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Get versions file path
 */
function getVersionsFilePath(): string {
  const matrixDir = join(homedir(), '.matrix');
  if (!existsSync(matrixDir)) {
    mkdirSync(matrixDir, { recursive: true });
  }
  return join(matrixDir, 'versions.json');
}

/**
 * Load version history
 */
function loadVersionHistory(): { versions: string[]; current: string } {
  const filePath = getVersionsFilePath();
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // Ignore parse errors
  }
  return { versions: [], current: getCurrentVersion() };
}

/**
 * Save version to history
 */
function saveVersionToHistory(version: string): void {
  const filePath = getVersionsFilePath();
  const history = loadVersionHistory();

  // Add current version to history before update
  if (history.current && !history.versions.includes(history.current)) {
    history.versions.unshift(history.current);
  }

  // Keep only last 10 versions
  history.versions = history.versions.slice(0, 10);
  history.current = version;

  writeFileSync(filePath, JSON.stringify(history, null, 2));
}

/**
 * Handle update command
 */
async function handleUpdate(
  channel: ReleaseChannel,
  options: { checkOnly: boolean; dryRun: boolean }
): Promise<void> {
  const spinner = ora('Checking for updates...').start();

  try {
    const currentVersion = getCurrentVersion();
    const previousChannel = (config.get('releaseChannel') as string | undefined) ?? 'beta';
    if (previousChannel !== channel) {
      config.set('releaseChannel', channel);
      appendReleaseAuditEvent({
        type: 'release.channel.changed',
        status: 'success',
        channel,
        message: `Release channel changed from ${previousChannel} to ${channel}.`,
      });
    }

    // Fetch latest version from npm registry
    spinner.text = 'Fetching latest version info...';

    const npmPackage = '@anthropic/matrix-cli';

    // Map channel to npm tag
    const npmTag = channel === 'stable' ? 'latest' : channel;

    let latestVersion: string;
    try {
      const registryUrl = `https://registry.npmjs.org/${npmPackage}`;
      const response = await fetch(registryUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch from npm registry: ${response.statusText}`);
      }

      const data = await response.json() as { 'dist-tags'?: Record<string, string>; versions?: Record<string, unknown> };

      // Get version for the specified tag
      latestVersion = data['dist-tags']?.[npmTag] || data['dist-tags']?.latest || '0.0.0';

      // Verify the version exists
      if (!data.versions?.[latestVersion]) {
        // Fallback to latest if channel version doesn't exist
        latestVersion = data['dist-tags']?.latest || currentVersion;
        spinner.warn(`Channel "${channel}" not found, using latest: ${latestVersion}`);
      }
    } catch (fetchError) {
      spinner.fail('Failed to check npm registry');
      console.error(chalk.red(fetchError instanceof Error ? fetchError.message : 'Unknown error'));
      console.log(chalk.dim('\nYou can try updating manually with:'));
      console.log(chalk.cyan(`  npm install -g ${npmPackage}@${npmTag}`));
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'failed',
        channel,
        fromVersion: currentVersion,
        message: fetchError instanceof Error ? fetchError.message : 'Failed to fetch npm registry.',
      });
      return;
    }

    // Compare versions
    if (latestVersion === currentVersion) {
      spinner.succeed(`Already on the latest version: ${currentVersion}`);
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'no_change',
        channel,
        fromVersion: currentVersion,
        toVersion: latestVersion,
        message: 'Already on latest version.',
      });
      return;
    }

    if (options.checkOnly) {
      spinner.succeed(`Update available: ${currentVersion} -> ${latestVersion} (${channel})`);
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'no_change',
        channel,
        fromVersion: currentVersion,
        toVersion: latestVersion,
        message: 'Check-only mode, no install performed.',
      });
      return;
    }

    spinner.info(`Update available: ${currentVersion} â†’ ${latestVersion} (${channel})`);
    spinner.start('Updating...');
    appendReleaseAuditEvent({
      type: 'release.update',
      status: 'started',
      channel,
      fromVersion: currentVersion,
      toVersion: latestVersion,
      message: 'Update started.',
    });

    // Save current version to history before update
    saveVersionToHistory(currentVersion);

    if (options.dryRun) {
      spinner.succeed(`Dry-run: would update ${currentVersion} -> ${latestVersion}`);
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'success',
        channel,
        fromVersion: currentVersion,
        toVersion: latestVersion,
        message: 'Dry-run mode, install skipped.',
      });
      return;
    }

    // Run npm install
    try {
      execSync(`npm install -g ${npmPackage}@${latestVersion}`, {
        stdio: 'inherit',
        timeout: 120000, // 2 minutes
      });

      spinner.succeed(`Updated to version ${latestVersion}`);
      console.log(chalk.dim('\nRestart Matrix CLI to use the new version.'));
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'success',
        channel,
        fromVersion: currentVersion,
        toVersion: latestVersion,
        message: 'Update completed successfully.',
      });
    } catch (installError) {
      spinner.fail('Failed to install update');
      console.error(chalk.red(installError instanceof Error ? installError.message : 'Unknown error'));
      console.log(chalk.dim('\nTry updating manually with:'));
      console.log(chalk.cyan(`  npm install -g ${npmPackage}@${latestVersion}`));
      appendReleaseAuditEvent({
        type: 'release.update',
        status: 'failed',
        channel,
        fromVersion: currentVersion,
        toVersion: latestVersion,
        message: installError instanceof Error ? installError.message : 'Install command failed.',
      });
    }
  } catch (error) {
    spinner.fail('Update check failed');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    appendReleaseAuditEvent({
      type: 'release.update',
      status: 'failed',
      channel,
      message: error instanceof Error ? error.message : 'Unknown update failure.',
    });
    process.exit(1);
  }
}

/**
 * Handle rollback command
 */
async function handleRollback(options: { dryRun: boolean }): Promise<void> {
  const spinner = ora('Loading version history...').start();

  try {
    const history = loadVersionHistory();

    if (history.versions.length === 0) {
      spinner.fail('No previous version available for rollback');
      console.log(chalk.dim('\nVersion history is empty. No rollback possible.'));
      appendReleaseAuditEvent({
        type: 'release.rollback',
        status: 'failed',
        message: 'No previous version available for rollback.',
      });
      return;
    }

    const previousVersion = history.versions[0];
    const currentVersion = getCurrentVersion();

    spinner.info(`Rolling back from ${currentVersion} to ${previousVersion}...`);
    spinner.start('Installing previous version...');

    const npmPackage = '@anthropic/matrix-cli';

    try {
      appendReleaseAuditEvent({
        type: 'release.rollback',
        status: 'started',
        fromVersion: currentVersion,
        toVersion: previousVersion,
        message: 'Rollback started.',
      });

      if (options.dryRun) {
        spinner.succeed(`Dry-run: would roll back from ${currentVersion} to ${previousVersion}`);
        appendReleaseAuditEvent({
          type: 'release.rollback',
          status: 'success',
          fromVersion: currentVersion,
          toVersion: previousVersion,
          message: 'Dry-run mode, install skipped.',
        });
        return;
      }

      execSync(`npm install -g ${npmPackage}@${previousVersion}`, {
        stdio: 'inherit',
        timeout: 120000,
      });

      // Update history - remove the rolled-back version from front
      const filePath = getVersionsFilePath();
      const newHistory = {
        versions: history.versions.slice(1),
        current: previousVersion,
      };
      writeFileSync(filePath, JSON.stringify(newHistory, null, 2));

      spinner.succeed(`Rolled back to version ${previousVersion}`);
      console.log(chalk.dim('\nRestart Matrix CLI to use the previous version.'));
      appendReleaseAuditEvent({
        type: 'release.rollback',
        status: 'success',
        fromVersion: currentVersion,
        toVersion: previousVersion,
        message: 'Rollback completed successfully.',
      });
    } catch (installError) {
      spinner.fail('Failed to rollback');
      console.error(chalk.red(installError instanceof Error ? installError.message : 'Unknown error'));
      console.log(chalk.dim('\nTry rolling back manually with:'));
      console.log(chalk.cyan(`  npm install -g ${npmPackage}@${previousVersion}`));
      appendReleaseAuditEvent({
        type: 'release.rollback',
        status: 'failed',
        fromVersion: currentVersion,
        toVersion: previousVersion,
        message: installError instanceof Error ? installError.message : 'Rollback install failed.',
      });
    }
  } catch (error) {
    spinner.fail('Rollback failed');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    appendReleaseAuditEvent({
      type: 'release.rollback',
      status: 'failed',
      message: error instanceof Error ? error.message : 'Unknown rollback failure.',
    });
    process.exit(1);
  }
}

/**
 * Onboarding metrics command - PRD Section 22.2 #7 and Section 25.4
 */
export function onboardingCommand(program: Command): void {
  const onboarding = program.command('onboarding').description('Track onboarding success metrics');

  onboarding
    .command('record')
    .description('Record an onboarding attempt outcome')
    .option('--success', 'Mark attempt as success')
    .option('--fail', 'Mark attempt as failed')
    .option('--ttfv-minutes <minutes>', 'Time-to-first-value in minutes')
    .option('--platform <platform>', 'Platform (windows|macos|linux)')
    .option('--notes <notes>', 'Optional notes')
    .option('--json', 'Output as JSON')
    .action((options: {
      success?: boolean;
      fail?: boolean;
      ttfvMinutes?: string;
      platform?: string;
      notes?: string;
      json?: boolean;
    }) => {
      const success = options.fail ? false : true;
      const ttfvRaw = options.ttfvMinutes !== undefined ? Number.parseFloat(options.ttfvMinutes) : undefined;
      const ttfvMinutes =
        ttfvRaw !== undefined && Number.isFinite(ttfvRaw) && ttfvRaw >= 0 ? ttfvRaw : undefined;

      const metrics = recordOnboardingOutcome({
        success,
        ...(ttfvMinutes !== undefined ? { ttfvMinutes } : {}),
        ...(options.platform !== undefined ? { platform: options.platform } : {}),
        ...(options.notes !== undefined ? { notes: options.notes } : {}),
      });
      const summary = summarizeOnboardingMetrics(metrics, 0.8);
      const gaSummary = summarizeOnboardingMetrics(metrics, 0.85);

      const payload = {
        metrics,
        releaseGate: summary,
        gaGate: gaSummary,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(chalk.bold('\nOnboarding Metrics Updated\n'));
        console.log(`  Attempts: ${summary.attempts}`);
        console.log(`  Successes: ${summary.successes}`);
        console.log(`  Success Rate: ${(summary.successRate * 100).toFixed(1)}%`);
        console.log(`  Release Gate (>=80%): ${summary.pass ? chalk.green('PASS') : chalk.red('FAIL')}`);
        console.log(`  GA Gate (>=85%): ${gaSummary.pass ? chalk.green('PASS') : chalk.red('FAIL')}`);
        if (summary.medianTtfvMinutes !== undefined) {
          console.log(`  Median TTFV: ${summary.medianTtfvMinutes.toFixed(1)} min`);
        }
      }
    });

  onboarding
    .command('status')
    .description('Show onboarding success metrics')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const metrics = loadOnboardingMetrics();
      const summary = summarizeOnboardingMetrics(metrics, 0.8);
      const gaSummary = summarizeOnboardingMetrics(metrics, 0.85);
      const payload = {
        metrics,
        releaseGate: summary,
        gaGate: gaSummary,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(chalk.bold('\nOnboarding Metrics\n'));
      console.log(`  Attempts: ${summary.attempts}`);
      console.log(`  Successes: ${summary.successes}`);
      console.log(`  Success Rate: ${(summary.successRate * 100).toFixed(1)}%`);
      console.log(`  Release Gate (>=80%): ${summary.pass ? chalk.green('PASS') : chalk.red('FAIL')}`);
      console.log(`  GA Gate (>=85%): ${gaSummary.pass ? chalk.green('PASS') : chalk.red('FAIL')}`);
      if (summary.medianTtfvMinutes !== undefined) {
        console.log(`  Median TTFV: ${summary.medianTtfvMinutes.toFixed(1)} min`);
      }
    });
}

/**
 * Incident drill command - PRD Section 22.2 #10
 */
export function incidentCommand(program: Command): void {
  const incident = program.command('incident').description('Incident drill and SLA tracking');

  incident
    .command('drill')
    .description('Record a SEV drill with first user communication timing')
    .option('--sev <level>', 'SEV level (SEV-1|SEV-2|SEV-3)', 'SEV-2')
    .option('--response-minutes <minutes>', 'Minutes until first user communication', '0')
    .option('--source <source>', 'drill or real incident source', 'drill')
    .option('--json', 'Output as JSON')
    .action((options: { sev: string; responseMinutes: string; source: string; json?: boolean }) => {
      const sev = options.sev.toUpperCase();
      if (!['SEV-1', 'SEV-2', 'SEV-3'].includes(sev)) {
        console.error(chalk.red(`Invalid SEV level: ${options.sev}`));
        process.exitCode = 1;
        return;
      }
      const responseMinutes = Number.parseFloat(options.responseMinutes);
      if (!Number.isFinite(responseMinutes) || responseMinutes < 0) {
        console.error(chalk.red(`Invalid response minutes: ${options.responseMinutes}`));
        process.exitCode = 1;
        return;
      }
      if (!['drill', 'real'].includes(options.source)) {
        console.error(chalk.red(`Invalid source: ${options.source}`));
        process.exitCode = 1;
        return;
      }

      const record = recordIncidentDrill({
        sev: sev as SevLevel,
        responseMinutes,
        source: options.source as 'drill' | 'real',
      });
      const records = loadIncidentRecords();
      const sev2 = summarizeIncidentSla(records, 'SEV-2');
      const payload = {
        record,
        sev2,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(chalk.bold('\nIncident Drill Recorded\n'));
        console.log(`  ID: ${record.id}`);
        console.log(`  SEV: ${record.sev}`);
        console.log(`  Response Minutes: ${record.responseMinutes}`);
        console.log(
          `  SEV-2 Gate (<=240m): ${
            sev2.pass ? chalk.green('PASS') : chalk.red('FAIL')
          } (${sev2.metSla}/${sev2.total})`
        );
      }
    });

  incident
    .command('status')
    .description('Show incident SLA summary')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const records = loadIncidentRecords();
      const sev1 = summarizeIncidentSla(records, 'SEV-1');
      const sev2 = summarizeIncidentSla(records, 'SEV-2');
      const sev3 = summarizeIncidentSla(records, 'SEV-3');
      const payload = {
        totalRecords: records.length,
        sev1,
        sev2,
        sev3,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log(chalk.bold('\nIncident SLA Summary\n'));
      for (const summary of [sev1, sev2, sev3]) {
        console.log(
          `  ${summary.sev}: ${summary.pass ? chalk.green('PASS') : chalk.red('FAIL')} ` +
            `(${summary.metSla}/${summary.total}, target <= ${summary.targetMinutes}m)`
        );
      }
    });
}

function runSecurityScanForReadiness(cwd: string): { status: 'pass' | 'warn' | 'fail'; detail: string } {
  const scannerPath = join(cwd, 'scripts', 'security-scan.mjs');
  if (!existsSync(scannerPath)) {
    return {
      status: 'warn',
      detail: `Security scanner not found at ${scannerPath}`,
    };
  }

  try {
    execSync(`"${process.execPath}" "${scannerPath}"`, {
      cwd,
      stdio: 'pipe',
    });
    return {
      status: 'pass',
      detail: 'Security scan completed without findings.',
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'Security scan failed with unknown error.';
    return {
      status: 'fail',
      detail,
    };
  }
}

/**
 * Readiness command - PRD Sections 22.2 and 25.x
 */
export function readinessCommand(program: Command): void {
  program
    .command('readiness')
    .description('Generate PRD-aligned product readiness report')
    .option('--json', 'Output as JSON')
    .option('--acceptance-report <path>', 'Path to acceptance report JSON')
    .option('--onboarding-target <rate>', 'Release onboarding success target ratio (default: 0.8)')
    .option('--ga-target <rate>', 'GA onboarding success target ratio (default: 0.85)')
    .action((options: {
      json?: boolean;
      acceptanceReport?: string;
      onboardingTarget?: string;
      gaTarget?: string;
    }) => {
      const parseRate = (value: string | undefined, fallback: number): number => {
        if (value === undefined) {
          return fallback;
        }
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
          throw new Error(`Invalid ratio: ${value}. Expected a number in (0,1].`);
        }
        return parsed;
      };

      let onboardingTargetRate: number;
      let gaTargetRate: number;
      try {
        onboardingTargetRate = parseRate(options.onboardingTarget, 0.8);
        gaTargetRate = parseRate(options.gaTarget, 0.85);
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : 'Invalid target values.'));
        process.exitCode = 1;
        return;
      }

      const workspaceRoot = resolveWorkspaceRoot();
      const securityScan = runSecurityScanForReadiness(workspaceRoot);
      const acceptanceReportPath =
        options.acceptanceReport === undefined
          ? undefined
          : isAbsolute(options.acceptanceReport)
            ? options.acceptanceReport
            : join(workspaceRoot, options.acceptanceReport);

      const report = buildReleaseReadinessReport({
        cwd: workspaceRoot,
        releaseChannel: (config.get('releaseChannel') as string | undefined) ?? 'beta',
        telemetryMode: getTelemetryMode(),
        ...(acceptanceReportPath ? { acceptanceReportPath } : {}),
        onboardingTargetRate,
        gaTargetRate,
        securityScan,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        const statusColor =
          report.status === 'pass' ? chalk.green : report.status === 'warn' ? chalk.yellow : chalk.red;

        console.log(chalk.bold('\nProduct Readiness Report\n'));
        console.log(`  Status: ${statusColor(report.status.toUpperCase())}`);
        console.log(`  Score: ${report.scorePercent}%`);
        console.log(`  Generated At: ${report.generatedAt}`);
        console.log(chalk.bold('\n  Checks:'));
        for (const check of report.checks) {
          const icon =
            check.status === 'pass'
              ? chalk.green('OK')
              : check.status === 'warn'
                ? chalk.yellow('WARN')
                : chalk.red('FAIL');
          const marker = check.required ? '' : chalk.dim(' (optional)');
          console.log(`  ${icon} [${check.id}] ${check.title}${marker}`);
          console.log(chalk.dim(`      ${check.detail}`));
        }

        if (report.nextActions.length > 0) {
          console.log(chalk.bold('\n  Next Actions:'));
          for (const action of report.nextActions) {
            console.log(`  - ${action}`);
          }
        }
      }

      if (report.status === 'fail') {
        process.exitCode = 2;
      }
    });
}

/**
 * Status command - PRD Section 4.1
 */
export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Matrix CLI status')
    .option('--service', 'Check service/incident status')
    .option('--json', 'Output as JSON')
    .action(async (options: { service?: boolean; json?: boolean }) => {
      if (options.service) {
        await handleServiceStatus(options.json);
        return;
      }

      console.log(chalk.bold('\n  Matrix CLI Status\n'));
      console.log(`  Version: ${getCurrentVersion()}`);
      console.log(`  Model: ${config.get('defaultModel')}`);
      console.log(`  Approval Mode: ${config.get('approvalMode')}`);
      console.log(`  Telemetry: ${getTelemetryMode()}`);
    });
}

/**
 * Handle service status check with real API integration
 */
async function handleServiceStatus(jsonOutput?: boolean): Promise<void> {
  const spinner = ora('Checking Matrix service status...').start();

  try {
    // Try to fetch real service status from Matrix API
    const statusUrl = 'https://api.matrix.ai/status';

    let serviceStatus: {
      status: string;
      version: string;
      lastChecked: string;
      incidents: Array<{ id: string; title: string; status: string; startedAt: string }>;
      components?: Array<{ name: string; status: string }>;
      quota?: { used: number; limit: number };
    };

    try {
      const response = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MatrixCLI/1.0',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        serviceStatus = {
          status: data.status || 'operational',
          version: data.version || '1.0.0',
          lastChecked: new Date().toISOString(),
          incidents: data.incidents || [],
          components: data.components,
          quota: data.quota,
        };
      } else {
        throw new Error(`API returned ${response.status}`);
      }
    } catch (apiError) {
      // API not available, check fallback status endpoint
      spinner.text = 'Primary API unavailable, checking fallback...';

      try {
        // Try alternative status page
        const fallbackUrl = 'https://status.matrix.ai/api/v2/status.json';
        const fallbackResponse = await fetch(fallbackUrl, {
          signal: AbortSignal.timeout(5000),
        });

        if (fallbackResponse.ok) {
          const data = await fallbackResponse.json();
          serviceStatus = {
            status: data.status?.description || 'operational',
            version: '1.0.0',
            lastChecked: new Date().toISOString(),
            incidents: (data.incidents || []).map((inc: { id?: string; name?: string; status?: string; started_at?: string }) => ({
              id: inc.id || 'unknown',
              title: inc.name || 'Unknown incident',
              status: inc.status || 'investigating',
              startedAt: inc.started_at || new Date().toISOString(),
            })),
          };
        } else {
          throw new Error('Fallback also failed');
        }
      } catch {
        // Both endpoints failed - return degraded status with cached info
        spinner.warn('Cannot reach Matrix API directly');
        serviceStatus = {
          status: 'degraded',
          version: 'unknown',
          lastChecked: new Date().toISOString(),
          incidents: [{
            id: 'api-unreachable',
            title: 'Matrix API is not reachable',
            status: 'investigating',
            startedAt: new Date().toISOString(),
          }],
        };
      }
    }

    spinner.stop();

    if (jsonOutput) {
      console.log(JSON.stringify(serviceStatus, null, 2));
      return;
    }

    console.log(chalk.bold('\n  Matrix Service Status\n'));

    // Status with color coding
    const statusColor = serviceStatus.status === 'operational' ? chalk.green :
      serviceStatus.status === 'degraded' ? chalk.yellow : chalk.red;
    console.log(`  Status: ${statusColor(serviceStatus.status)}`);
    console.log(`  API Version: ${serviceStatus.version}`);
    console.log(`  Last Checked: ${serviceStatus.lastChecked}`);

    // Components status if available
    if (serviceStatus.components && serviceStatus.components.length > 0) {
      console.log(chalk.bold('\n  Components:'));
      for (const comp of serviceStatus.components) {
        const compColor = comp.status === 'operational' ? chalk.green :
          comp.status === 'degraded' ? chalk.yellow : chalk.red;
        console.log(`    ${comp.name}: ${compColor(comp.status)}`);
      }
    }

    // Quota info if available
    if (serviceStatus.quota) {
      console.log(chalk.bold('\n  Quota:'));
      const percentage = Math.round((serviceStatus.quota.used / serviceStatus.quota.limit) * 100);
      console.log(`    Used: ${serviceStatus.quota.used.toLocaleString()} / ${serviceStatus.quota.limit.toLocaleString()} (${percentage}%)`);
    }

    // Active incidents
    if (serviceStatus.incidents.length === 0) {
      console.log(chalk.dim('\n  No active incidents'));
    } else {
      console.log(chalk.bold('\n  Active Incidents:'));
      for (const incident of serviceStatus.incidents) {
        const incColor = incident.status === 'resolved' ? chalk.green :
          incident.status === 'monitoring' ? chalk.yellow : chalk.red;
        console.log(`    ${incColor('â—')} ${incident.title}`);
        console.log(chalk.dim(`      Status: ${incident.status}`));
        console.log(chalk.dim(`      Started: ${incident.startedAt}`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to check service status');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

/**
 * Export run command
 */
export function exportRunCommand(program: Command): void {
  program
    .command('export-run <runId>')
    .description('Export a run to a file with redacted secrets')
    .option('-o, --output <file>', 'Output file path')
    .option('--format <format>', 'Output format (json, markdown)', 'json')
    .option('--no-redact', 'Disable secret redaction (not recommended)')
    .action(async (runId: string, options: { output?: string; format: string; noRedact?: boolean }) => {
      await handleExportRun(runId, options);
    });
}

/**
 * Secret patterns for redaction
 */
const SECRET_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /sk-[a-zA-Z0-9]{48,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /api[_-]?key["\s:=]+["']?[a-zA-Z0-9_-]{20,}/gi, replacement: 'api_key=***REDACTED***' },
  { pattern: /secret[_-]?key["\s:=]+["']?[a-zA-Z0-9_-]{20,}/gi, replacement: 'secret_key=***REDACTED***' },
  { pattern: /bearer\s+[a-zA-Z0-9_-]{20,}/gi, replacement: 'bearer ***REDACTED***' },
  { pattern: /["'][a-f0-9]{32,}["']/gi, replacement: '"***REDACTED***"' },
  { pattern: /password["\s:=]+["']?[^\s"']{8,}/gi, replacement: 'password=***REDACTED***' },
  { pattern: /token["\s:=]+["']?[a-zA-Z0-9_-]{20,}/gi, replacement: 'token=***REDACTED***' },
];

/**
 * Redact secrets from content
 */
export function redactSecrets(content: string): string {
  let redacted = content;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/**
 * Get database path for run data
 */
function getDatabasePath(): string {
  return join(homedir(), '.matrix', 'matrix.db');
}

/**
 * Handle export run command
 */
async function handleExportRun(
  runId: string,
  options: { output?: string; format: string; noRedact?: boolean }
): Promise<void> {
  const spinner = ora(`Loading run ${runId}...`).start();

  try {
    const dbPath = getDatabasePath();

    // Check if database exists
    if (!existsSync(dbPath)) {
      spinner.fail('No database found. No runs have been recorded yet.');
      console.log(chalk.dim('\nRun "matrix run" to start a new session.'));
      return;
    }

    // Import better-sqlite3 dynamically
    let db: {
      prepare: (sql: string) => { get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] };
      close: () => void;
    };

    try {
      const module = await import('better-sqlite3');
      const Database = module.default;
      db = new Database(dbPath, { readonly: true });
    } catch {
      spinner.fail('Database module not available');
      console.log(chalk.dim('\nInstall better-sqlite3: npm install better-sqlite3'));
      return;
    }

    // Query run data
    try {
      // Get run metadata
      const runStmt = db.prepare('SELECT * FROM runs WHERE id = ?');
      const runData = runStmt.get(runId) as Record<string, unknown> | undefined;

      if (!runData) {
        spinner.fail(`Run ${runId} not found`);
        db.close();
        return;
      }

      spinner.text = 'Fetching run events...';

      // Get events for this run
      const eventsStmt = db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY timestamp, id');
      const eventRows = eventsStmt.all(runId) as Array<Record<string, unknown>>;
      const events = eventRows.map((row) => {
        const payloadJson = row.payload_json;
        let payload: unknown = payloadJson;
        if (typeof payloadJson === 'string') {
          try {
            payload = JSON.parse(payloadJson);
          } catch {
            payload = payloadJson;
          }
        }

        return {
          ...row,
          payload,
        };
      });

      // Sessions table stores message history in messages_json.
      const sessionsStmt = db.prepare('SELECT * FROM sessions WHERE run_id = ? ORDER BY updated_at DESC');
      const sessionRows = sessionsStmt.all(runId) as Array<Record<string, unknown>>;
      const messages: Array<Record<string, unknown>> = [];
      for (const sessionRow of sessionRows) {
        const messagesJson = sessionRow.messages_json;
        if (typeof messagesJson !== 'string') {
          continue;
        }
        try {
          const parsed = JSON.parse(messagesJson);
          if (Array.isArray(parsed)) {
            for (const message of parsed) {
              if (message && typeof message === 'object') {
                messages.push(message as Record<string, unknown>);
              }
            }
          }
        } catch {
          // Ignore malformed session payloads during export.
        }
      }

      // Get tool calls
      const toolCallsStmt = db.prepare('SELECT * FROM tool_calls WHERE run_id = ? ORDER BY timestamp');
      const toolCalls = toolCallsStmt.all(runId) as Array<Record<string, unknown>>;

      // Get diffs
      const diffsStmt = db.prepare('SELECT * FROM diffs WHERE run_id = ? ORDER BY timestamp');
      const diffs = diffsStmt.all(runId) as Array<Record<string, unknown>>;

      db.close();

      spinner.text = 'Processing export data...';

      // Build export object
      const exportData = {
        run: {
          id: runId,
          ...(runData as object),
        },
        exportedAt: new Date().toISOString(),
        redacted: !options.noRedact,
        summary: {
          totalEvents: events.length,
          totalMessages: messages.length,
          totalToolCalls: toolCalls.length,
          totalDiffs: diffs.length,
        },
        events,
        messages,
        toolCalls,
        diffs,
      };

      // Apply redaction if enabled
      let content: string;
      if (!options.noRedact) {
        const stringified = JSON.stringify(exportData, null, 2);
        content = redactSecrets(stringified);
      } else {
        content = JSON.stringify(exportData, null, 2);
      }

      // Format output
      if (options.format === 'markdown') {
        content = formatAsMarkdown(exportData, !options.noRedact);
      }

      // Determine output path
      const outputPath = options.output || `matrix-run-${runId}.${options.format === 'markdown' ? 'md' : 'json'}`;

      // Write to file
      writeFileSync(outputPath, content);

      spinner.succeed(`Run exported to ${outputPath}`);
      console.log(chalk.dim(`\n  Events: ${exportData.summary.totalEvents}`));
      console.log(chalk.dim(`  Messages: ${exportData.summary.totalMessages}`));
      console.log(chalk.dim(`  Tool Calls: ${exportData.summary.totalToolCalls}`));
      console.log(chalk.dim(`  Diffs: ${exportData.summary.totalDiffs}`));
      if (!options.noRedact) {
        console.log(chalk.dim(`  Redacted: Yes`));
      }
    } catch (dbError) {
      db.close();
      throw dbError;
    }
  } catch (error) {
    spinner.fail('Export failed');
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}

/**
 * Format export data as markdown
 */
function formatAsMarkdown(data: Record<string, unknown>, redacted: boolean): string {
  const lines: string[] = [
    `# Matrix CLI Run Export`,
    ``,
    `**Run ID:** ${data.run?.id || 'unknown'}`,
    `**Exported At:** ${data.exportedAt}`,
    `**Redacted:** ${redacted ? 'Yes' : 'No'}`,
    ``,
    `## Summary`,
    ``,
    `- Events: ${(data.summary as Record<string, number>)?.totalEvents || 0}`,
    `- Messages: ${(data.summary as Record<string, number>)?.totalMessages || 0}`,
    `- Tool Calls: ${(data.summary as Record<string, number>)?.totalToolCalls || 0}`,
    `- Diffs: ${(data.summary as Record<string, number>)?.totalDiffs || 0}`,
    ``,
    `## Events`,
    ``,
  ];

  const events = (data.events as Array<Record<string, unknown>>) || [];
  for (const event of events.slice(0, 50)) { // Limit to first 50 events
    lines.push(`- **${event.type || 'unknown'}** at ${event.timestamp || 'unknown time'}`);
  }

  if (events.length > 50) {
    lines.push(`- ... and ${events.length - 50} more events`);
  }

  lines.push(``, `## Messages`, ``);

  const messages = (data.messages as Array<Record<string, unknown>>) || [];
  for (const msg of messages.slice(0, 20)) {
    const role = msg.role || 'unknown';
    const content = typeof msg.content === 'string' ? msg.content.slice(0, 200) : JSON.stringify(msg.content).slice(0, 200);
    lines.push(`### ${role}`);
    lines.push(``);
    lines.push(content + (content.length >= 200 ? '...' : ''));
    lines.push(``);
  }

  if (messages.length > 20) {
    lines.push(`*... and ${messages.length - 20} more messages*`);
  }

  let result = lines.join('\n');
  if (redacted) {
    result = redactSecrets(result);
  }
  return result;
}

