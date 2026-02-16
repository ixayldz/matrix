import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAnalyticsEnvelope,
  runTelemetrySelfTest,
  sanitizeAnalyticsProperties,
  recordOnboardingOutcome,
  loadOnboardingMetrics,
  summarizeOnboardingMetrics,
  recordIncidentDrill,
  loadIncidentRecords,
  summarizeIncidentSla,
} from './ops-metrics.js';

const ORIGINAL_ONBOARDING_PATH = process.env.MATRIX_ONBOARDING_METRICS_PATH;
const ORIGINAL_INCIDENT_PATH = process.env.MATRIX_INCIDENT_LOG_PATH;

afterEach(() => {
  if (ORIGINAL_ONBOARDING_PATH === undefined) {
    delete process.env.MATRIX_ONBOARDING_METRICS_PATH;
  } else {
    process.env.MATRIX_ONBOARDING_METRICS_PATH = ORIGINAL_ONBOARDING_PATH;
  }

  if (ORIGINAL_INCIDENT_PATH === undefined) {
    delete process.env.MATRIX_INCIDENT_LOG_PATH;
  } else {
    process.env.MATRIX_INCIDENT_LOG_PATH = ORIGINAL_INCIDENT_PATH;
  }
});

describe('telemetry privacy helpers', () => {
  it('disables analytics payload when telemetry mode is off', () => {
    const envelope = createAnalyticsEnvelope(
      'sample',
      { command: 'run', prompt: 'should not be collected' },
      'off'
    );
    expect(envelope.enabled).toBe(false);
    expect(envelope.reason).toBe('telemetry_off');
  });

  it('filters forbidden keys and redacts secret-like values', () => {
    const sanitized = sanitizeAnalyticsProperties(
      {
        command: 'run',
        prompt: 'raw prompt',
        reason: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
      },
      'minimal'
    );
    expect(sanitized.command).toBe('run');
    expect('prompt' in sanitized).toBe(false);
    expect(String(sanitized.reason)).toContain('REDACTED');
  });

  it('passes telemetry self-test in minimal mode', () => {
    const report = runTelemetrySelfTest('minimal');
    expect(report.pass).toBe(true);
    expect(report.checks.length).toBeGreaterThan(1);
  });
});

describe('onboarding metrics helpers', () => {
  it('records outcomes and computes release gate rate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-onboarding-'));
    process.env.MATRIX_ONBOARDING_METRICS_PATH = join(dir, 'onboarding.json');

    recordOnboardingOutcome({ success: true, ttfvMinutes: 10 });
    recordOnboardingOutcome({ success: false, ttfvMinutes: 22 });
    recordOnboardingOutcome({ success: true, ttfvMinutes: 12 });

    const metrics = loadOnboardingMetrics();
    const summary = summarizeOnboardingMetrics(metrics, 0.8);
    expect(summary.attempts).toBe(3);
    expect(summary.successes).toBe(2);
    expect(summary.successRate).toBeCloseTo(2 / 3, 5);
    expect(summary.pass).toBe(false);
  });
});

describe('incident SLA helpers', () => {
  it('summarizes sev-2 first-response SLA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-incident-'));
    process.env.MATRIX_INCIDENT_LOG_PATH = join(dir, 'incidents.json');

    recordIncidentDrill({ sev: 'SEV-2', responseMinutes: 30, source: 'drill' });
    recordIncidentDrill({ sev: 'SEV-2', responseMinutes: 90, source: 'drill' });
    const records = loadIncidentRecords();
    const summary = summarizeIncidentSla(records, 'SEV-2');

    expect(summary.total).toBe(2);
    expect(summary.metSla).toBe(2);
    expect(summary.pass).toBe(true);
    expect(summary.targetMinutes).toBe(240);
  });
});
