import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

/**
 * Quota tracking configuration
 */
export interface QuotaConfig {
  /** Soft limit percentage (warn when exceeded) */
  softLimitPercent: number;
  /** Hard limit percentage (block when exceeded) */
  hardLimitPercent: number;
  /** Warning threshold for daily requests */
  dailyRequestWarnThreshold: number;
  /** Block threshold for daily requests */
  dailyRequestBlockThreshold: number;
  /** Enable warnings */
  enableWarnings: boolean;
  /** Auto-reset interval in hours */
  resetIntervalHours: number;
  /** Hard limit handling strategy (PRD Section 21.7) */
  hardLimitBehavior: HardLimitBehavior;
  /** Estimated queue ETA (minutes) when hard limit behavior is queue */
  queueEtaMinutes: number;
}

/**
 * Quota hard limit behavior modes
 */
export type HardLimitBehavior = 'block' | 'degrade' | 'queue';

/**
 * Default quota configuration
 */
const DEFAULT_QUOTA_CONFIG: QuotaConfig = {
  softLimitPercent: 0.80, // 80%
  hardLimitPercent: 0.95, // 95%
  dailyRequestWarnThreshold: 0.80,
  dailyRequestBlockThreshold: 0.95,
  enableWarnings: true,
  resetIntervalHours: 24,
  hardLimitBehavior: 'block',
  queueEtaMinutes: 15,
};

/**
 * Quota usage record
 */
export interface QuotaUsage {
  /** Token usage by day */
  tokenUsage: Record<string, number>;
  /** Request count by day */
  requestCount: Record<string, number>;
  /** Current period start */
  periodStart: string;
  /** Current period end */
  periodEnd: string;
  /** Last update timestamp */
  lastUpdated: number;
}

/**
 * Quota limit information
 */
export interface QuotaLimits {
  /** Maximum tokens per month */
  tokensPerMonth: number;
  /** Maximum requests per day */
  requestsPerDay: number;
  /** Maximum context tokens */
  maxContextTokens: number;
}

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  /** Whether operation is allowed */
  allowed: boolean;
  /** Current usage status */
  usage: {
    tokensUsed: number;
    tokensLimit: number;
    tokensPercent: number;
    requestsToday: number;
    requestsLimit: number;
    requestsPercent: number;
  };
  /** Warning message if applicable */
  warning?: string;
  /** Block reason if blocked */
  blockReason?: string;
  /** Recommended action */
  action: 'allow' | 'warn' | 'block';
  /** Command-result mapping for PRD contract compatibility */
  resultType: 'allow' | 'warn' | 'needs_input' | 'degraded' | 'queued';
  /** UX hint for next user/system step */
  recommendedAction?: string;
  /** Degraded profile name when hard-limit behavior is degrade */
  degradedProfile?: 'cheap';
  /** Queue details when hard-limit behavior is queue */
  queue?: {
    etaMinutes: number;
    queuedAt: string;
  };
}

/**
 * Quota event for callbacks
 */
export interface QuotaEvent {
  type: 'soft_limit' | 'hard_limit' | 'daily_limit' | 'reset' | 'warning';
  timestamp: number;
  usage: QuotaUsage;
  message: string;
}

/**
 * Quota event callback
 */
export type QuotaEventCallback = (event: QuotaEvent) => void;

/**
 * Quota Manager - Tracks and enforces usage limits
 *
 * Implements PRD requirements for quota management:
 * - Soft limit: warn when exceeded
 * - Hard limit: block when exceeded
 * - Daily tracking
 * - Monthly reset
 */
export class QuotaManager {
  private config: QuotaConfig;
  private limits: QuotaLimits;
  private usage: QuotaUsage;
  private callbacks: QuotaEventCallback[] = [];
  private storagePath: string;

  constructor(limits: QuotaLimits, config?: Partial<QuotaConfig>) {
    this.config = { ...DEFAULT_QUOTA_CONFIG, ...config };
    this.limits = limits;
    this.storagePath = join(homedir(), '.matrix', 'quota.json');
    this.usage = this.getDefaultUsage();
    this.loadUsage();
  }

  /**
   * Resolve hard-limit action deterministically based on configured behavior.
   * PRD 21.7 contract:
   * - block => needs_input
   * - degrade => downgrade profile
   * - queue => queue task with ETA
   */
  private resolveHardLimitResult(
    usage: QuotaCheckResult['usage'],
    reason: string
  ): QuotaCheckResult {
    switch (this.config.hardLimitBehavior) {
      case 'degrade':
        return {
          allowed: true,
          usage,
          warning: `${reason} Auto-degrading to low-cost profile.`,
          action: 'warn',
          resultType: 'degraded',
          degradedProfile: 'cheap',
          recommendedAction: 'Execution continues with degraded profile: cheap.',
        };

      case 'queue':
        return {
          allowed: false,
          usage,
          blockReason: reason,
          action: 'block',
          resultType: 'queued',
          queue: {
            etaMinutes: Math.max(1, this.config.queueEtaMinutes),
            queuedAt: new Date().toISOString(),
          },
          recommendedAction: 'Task queued due to quota exhaustion. Wait for ETA or upgrade plan.',
        };

      case 'block':
      default:
        return {
          allowed: false,
          usage,
          blockReason: reason,
          action: 'block',
          resultType: 'needs_input',
          recommendedAction: 'Quota exceeded. Reduce workload, wait for reset, or upgrade plan.',
        };
    }
  }

  /**
   * Get default usage structure
   */
  private getDefaultUsage(): QuotaUsage {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return {
      tokenUsage: {},
      requestCount: {},
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * Load usage from disk
   */
  private async loadUsage(): Promise<void> {
    try {
      if (existsSync(this.storagePath)) {
        const data = await readFile(this.storagePath, 'utf-8');
        const usage = JSON.parse(data) as QuotaUsage;

        // Check if we need to reset for new period
        const periodEnd = new Date(usage.periodEnd);
        if (new Date() > periodEnd) {
          this.usage = this.getDefaultUsage();
        } else {
          this.usage = usage;
        }
      }
    } catch {
      this.usage = this.getDefaultUsage();
    }
  }

  /**
   * Save usage to disk
   */
  private async saveUsage(): Promise<void> {
    try {
      const storageDir = join(homedir(), '.matrix');
      if (!existsSync(storageDir)) {
        const { mkdir } = await import('fs/promises');
        await mkdir(storageDir, { recursive: true });
      }

      this.usage.lastUpdated = Date.now();
      await writeFile(this.storagePath, JSON.stringify(this.usage, null, 2));
    } catch (error) {
      console.error('Failed to save quota usage:', error);
    }
  }

  /**
   * Get today's date key
   */
  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0] || '';
  }

  /**
   * Get total tokens used this period
   */
  getTotalTokensUsed(): number {
    return Object.values(this.usage.tokenUsage).reduce((sum, val) => sum + val, 0);
  }

  /**
   * Get requests made today
   */
  getRequestsToday(): number {
    const today = this.getTodayKey();
    return this.usage.requestCount[today] || 0;
  }

  /**
   * Check if operation is allowed
   */
  checkQuota(tokensNeeded: number = 0): QuotaCheckResult {
    const tokensUsed = this.getTotalTokensUsed();
    const requestsToday = this.getRequestsToday();

    const tokensPercent = tokensUsed / this.limits.tokensPerMonth;
    const requestsPercent = requestsToday / this.limits.requestsPerDay;

    const usage = {
      tokensUsed,
      tokensLimit: this.limits.tokensPerMonth,
      tokensPercent: tokensPercent * 100,
      requestsToday,
      requestsLimit: this.limits.requestsPerDay,
      requestsPercent: requestsPercent * 100,
    };

    // Check hard limits
    if (tokensPercent >= this.config.hardLimitPercent) {
      const reason = `Token hard limit exceeded: ${(tokensPercent * 100).toFixed(1)}% used`;
      const result = this.resolveHardLimitResult(usage, reason);
      this.emitEvent({
        type: 'hard_limit',
        timestamp: Date.now(),
        usage: this.usage,
        message: result.blockReason ?? result.warning ?? reason,
      });
      return result;
    }

    if (requestsPercent >= this.config.dailyRequestBlockThreshold) {
      const reason = `Daily request limit exceeded: ${requestsToday}/${this.limits.requestsPerDay}`;
      const result = this.resolveHardLimitResult(usage, reason);
      this.emitEvent({
        type: 'daily_limit',
        timestamp: Date.now(),
        usage: this.usage,
        message: result.blockReason ?? result.warning ?? reason,
      });
      return result;
    }

    // Check if operation would exceed limits
    if (tokensUsed + tokensNeeded > this.limits.tokensPerMonth) {
      const reason = `Operation would exceed token limit. Remaining: ${this.limits.tokensPerMonth - tokensUsed}`;
      const result = this.resolveHardLimitResult(usage, reason);
      return result;
    }

    // Check soft limits
    let warning: string | undefined;
    if (tokensPercent >= this.config.softLimitPercent) {
      warning = `Approaching token limit: ${(tokensPercent * 100).toFixed(1)}% used`;
      this.emitEvent({
        type: 'soft_limit',
        timestamp: Date.now(),
        usage: this.usage,
        message: warning,
      });
    } else if (requestsPercent >= this.config.dailyRequestWarnThreshold) {
      warning = `Approaching daily request limit: ${requestsToday}/${this.limits.requestsPerDay}`;
      this.emitEvent({
        type: 'warning',
        timestamp: Date.now(),
        usage: this.usage,
        message: warning,
      });
    }

    const warningMessage = this.config.enableWarnings ? warning : undefined;

    return {
      allowed: true,
      usage,
      ...(warningMessage !== undefined ? { warning: warningMessage } : {}),
      action: warningMessage ? 'warn' : 'allow',
      resultType: warningMessage ? 'warn' : 'allow',
    };
  }

  /**
   * Record token usage
   */
  async recordUsage(tokens: number): Promise<void> {
    const today = this.getTodayKey();

    // Update token usage
    this.usage.tokenUsage[today] = (this.usage.tokenUsage[today] || 0) + tokens;

    // Update request count
    this.usage.requestCount[today] = (this.usage.requestCount[today] || 0) + 1;

    await this.saveUsage();

    // Check limits after recording
    this.checkQuota(0);
  }

  /**
   * Record a request (without tokens)
   */
  async recordRequest(): Promise<void> {
    const today = this.getTodayKey();
    this.usage.requestCount[today] = (this.usage.requestCount[today] || 0) + 1;
    await this.saveUsage();
  }

  /**
   * Get usage statistics
   */
  getStats(): {
    current: QuotaCheckResult['usage'];
    period: {
      start: string;
      end: string;
      daysRemaining: number;
    };
    projections: {
      estimatedMonthlyTokens: number;
      onTrack: boolean;
    };
  } {
    const tokensUsed = this.getTotalTokensUsed();
    const periodStart = new Date(this.usage.periodStart);
    const periodEnd = new Date(this.usage.periodEnd);
    const now = new Date();

    const daysInPeriod = Math.ceil(
      (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysPassed = Math.ceil(
      (now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysRemaining = daysInPeriod - daysPassed;

    // Project monthly usage based on current rate
    const avgDailyTokens = daysPassed > 0 ? tokensUsed / daysPassed : 0;
    const estimatedMonthlyTokens = avgDailyTokens * daysInPeriod;
    const onTrack = estimatedMonthlyTokens <= this.limits.tokensPerMonth;

    return {
      current: {
        tokensUsed,
        tokensLimit: this.limits.tokensPerMonth,
        tokensPercent: (tokensUsed / this.limits.tokensPerMonth) * 100,
        requestsToday: this.getRequestsToday(),
        requestsLimit: this.limits.requestsPerDay,
        requestsPercent: (this.getRequestsToday() / this.limits.requestsPerDay) * 100,
      },
      period: {
        start: this.usage.periodStart,
        end: this.usage.periodEnd,
        daysRemaining: Math.max(0, daysRemaining),
      },
      projections: {
        estimatedMonthlyTokens: Math.round(estimatedMonthlyTokens),
        onTrack,
      },
    };
  }

  /**
   * Reset usage for new period
   */
  async reset(): Promise<void> {
    const oldUsage = { ...this.usage };
    this.usage = this.getDefaultUsage();
    await this.saveUsage();

    this.emitEvent({
      type: 'reset',
      timestamp: Date.now(),
      usage: oldUsage,
      message: 'Quota usage has been reset for new period',
    });
  }

  /**
   * Update limits
   */
  updateLimits(newLimits: Partial<QuotaLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
  }

  /**
   * Get current limits
   */
  getLimits(): QuotaLimits {
    return { ...this.limits };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<QuotaConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Register event callback
   */
  onEvent(callback: QuotaEventCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to callbacks
   */
  private emitEvent(event: QuotaEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Quota callback error:', error);
      }
    }
  }

  /**
   * Estimate token count for text
   */
  static estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate token count for messages
   */
  static estimateMessageTokens(messages: Array<{ content: string }>): number {
    let total = 0;
    for (const msg of messages) {
      // Add overhead for message structure (~4 tokens per message)
      total += 4;
      total += this.estimateTokens(msg.content);
    }
    return total;
  }
}

/**
 * Create a quota manager
 */
export function createQuotaManager(
  limits: QuotaLimits,
  config?: Partial<QuotaConfig>
): QuotaManager {
  return new QuotaManager(limits, config);
}

/**
 * Predefined quota limits for different plans
 */
export const PLAN_LIMITS: Record<string, QuotaLimits> = {
  free: {
    tokensPerMonth: 100_000,
    requestsPerDay: 100,
    maxContextTokens: 8_000,
  },
  starter: {
    tokensPerMonth: 500_000,
    requestsPerDay: 500,
    maxContextTokens: 16_000,
  },
  pro: {
    tokensPerMonth: 2_000_000,
    requestsPerDay: 2_000,
    maxContextTokens: 32_000,
  },
  enterprise: {
    tokensPerMonth: 10_000_000,
    requestsPerDay: 10_000,
    maxContextTokens: 128_000,
  },
};
