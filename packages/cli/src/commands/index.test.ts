import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendReleaseAuditEvent,
  buildPlansResponse,
  getReleaseAuditLogPath,
  isValidReleaseChannel,
} from './index.js';

const ORIGINAL_AUDIT_PATH = process.env.MATRIX_AUDIT_LOG_PATH;

afterEach(() => {
  if (ORIGINAL_AUDIT_PATH === undefined) {
    delete process.env.MATRIX_AUDIT_LOG_PATH;
  } else {
    process.env.MATRIX_AUDIT_LOG_PATH = ORIGINAL_AUDIT_PATH;
  }
});

describe('release channel and audit helpers', () => {
  it('validates supported release channels', () => {
    expect(isValidReleaseChannel('alpha')).toBe(true);
    expect(isValidReleaseChannel('beta')).toBe(true);
    expect(isValidReleaseChannel('stable')).toBe(true);
    expect(isValidReleaseChannel('nightly')).toBe(false);
  });

  it('writes release audit events as jsonl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-audit-'));
    const auditFile = join(dir, 'events.jsonl');
    process.env.MATRIX_AUDIT_LOG_PATH = auditFile;

    appendReleaseAuditEvent({
      type: 'release.update',
      status: 'success',
      channel: 'beta',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      message: 'Updated for test.',
    });

    const resolved = getReleaseAuditLogPath();
    expect(resolved).toBe(auditFile);

    const lines = readFileSync(auditFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0] ?? '{}') as Record<string, string>;
    expect(payload.eventVersion).toBe('v1');
    expect(payload.type).toBe('release.update');
    expect(payload.status).toBe('success');
    expect(payload.channel).toBe('beta');
  });
});

describe('auth plans response contract', () => {
  it('builds PRD-compliant plans payload fields', () => {
    const plan = {
      id: 'pro',
      name: 'pro',
      limits: {
        tokensPerMonth: 2000000,
        requestsPerDay: 2000,
        maxContextTokens: 32000,
        features: ['basic', 'advanced'],
      },
      current: true,
    };
    const quota = {
      tokensUsed: 1500000,
      tokensLimit: 2000000,
      requestsToday: 400,
      requestsLimit: 2000,
      resetsAt: new Date(Date.now() + 86400000).toISOString(),
    };

    const result = buildPlansResponse(plan, quota, 'degrade');
    expect(result.planId).toBe('pro');
    expect(result.tier).toBe('pro');
    expect(result.remaining.tokens).toBe(500000);
    expect(result.hardLimit.tokens).toBe(2000000);
    expect(result.hardLimitBehavior).toBe('degrade');
    expect(typeof result.recommendedAction).toBe('string');
  });
});
