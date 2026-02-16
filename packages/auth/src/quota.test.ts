import { describe, expect, it } from 'vitest';
import { QuotaManager } from './quota.js';

const limits = {
  tokensPerMonth: 100,
  requestsPerDay: 10,
  maxContextTokens: 8000,
};

describe('QuotaManager hard-limit behavior contract', () => {
  it('returns needs_input when hardLimitBehavior=block', () => {
    const manager = new QuotaManager(limits, {
      hardLimitBehavior: 'block',
    });

    const result = manager.checkQuota(101);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe('block');
    expect(result.resultType).toBe('needs_input');
    expect(result.recommendedAction?.toLowerCase()).toContain('upgrade');
  });

  it('degrades automatically when hardLimitBehavior=degrade', () => {
    const manager = new QuotaManager(limits, {
      hardLimitBehavior: 'degrade',
    });

    const result = manager.checkQuota(101);
    expect(result.allowed).toBe(true);
    expect(result.action).toBe('warn');
    expect(result.resultType).toBe('degraded');
    expect(result.degradedProfile).toBe('cheap');
    expect(result.warning?.toLowerCase()).toContain('degrading');
  });

  it('queues task with eta when hardLimitBehavior=queue', () => {
    const manager = new QuotaManager(limits, {
      hardLimitBehavior: 'queue',
      queueEtaMinutes: 22,
    });

    const result = manager.checkQuota(101);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe('block');
    expect(result.resultType).toBe('queued');
    expect(result.queue?.etaMinutes).toBe(22);
    expect(result.queue?.queuedAt).toBeDefined();
  });
});
