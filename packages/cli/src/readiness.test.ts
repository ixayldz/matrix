import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReleaseReadinessReport } from './readiness.js';
import { recordOnboardingOutcome, recordIncidentDrill } from './ops-metrics.js';

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

function createWorkspaceFixture(): {
  cwd: string;
  acceptancePath: string;
  auditPath: string;
} {
  const cwd = mkdtempSync(join(tmpdir(), 'matrix-readiness-'));
  const workflowDir = join(cwd, '.github', 'workflows');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(workflowDir, 'ci.yml'),
    [
      'name: CI',
      'jobs:',
      '  test:',
      '    strategy:',
      '      matrix:',
      '        os: [ubuntu-latest, windows-latest, macos-latest]',
      '    steps:',
      "      - run: pnpm --filter @matrix/cli exec node dist/index.js update --channel beta --check",
      "      - run: pnpm --filter @matrix/cli exec node dist/index.js update --rollback --dry-run",
      '',
    ].join('\n')
  );

  const onboardingDocsDir = join(cwd, 'docs', 'onboarding');
  mkdirSync(onboardingDocsDir, { recursive: true });
  writeFileSync(join(onboardingDocsDir, 'quickstart.md'), '# Quickstart');
  writeFileSync(join(onboardingDocsDir, 'provider-keys.md'), '# Provider Keys');
  writeFileSync(join(onboardingDocsDir, 'doctor-troubleshooting.md'), '# Doctor Troubleshooting');
  writeFileSync(join(onboardingDocsDir, 'known-limitations.md'), '# Known Limitations');

  const acceptancePath = join(cwd, 'acceptance-report.json');
  writeFileSync(
    acceptancePath,
    JSON.stringify(
      {
        success: true,
        numFailedTests: 0,
        numPassedTests: 19,
        testResults: [
          {
            assertionResults: [
              { title: 'K10: run export redaction removes sensitive values', status: 'passed' },
              { title: 'K16: quota hard-limit behaviors satisfy block/degrade/queue contract', status: 'passed' },
            ],
          },
        ],
      },
      null,
      2
    )
  );

  const auditPath = join(cwd, 'audit.jsonl');
  const now = new Date().toISOString();
  appendFileSync(
    auditPath,
    JSON.stringify({
      eventVersion: 'v1',
      timestamp: now,
      type: 'release.update',
      status: 'success',
    }) + '\n'
  );
  appendFileSync(
    auditPath,
    JSON.stringify({
      eventVersion: 'v1',
      timestamp: now,
      type: 'release.rollback',
      status: 'success',
    }) + '\n'
  );

  return {
    cwd,
    acceptancePath,
    auditPath,
  };
}

describe('buildReleaseReadinessReport', () => {
  it('returns pass when required release gates are satisfied', () => {
    const fixture = createWorkspaceFixture();
    process.env.MATRIX_ONBOARDING_METRICS_PATH = join(fixture.cwd, 'onboarding.json');
    process.env.MATRIX_INCIDENT_LOG_PATH = join(fixture.cwd, 'incidents.json');

    for (let i = 0; i < 5; i += 1) {
      recordOnboardingOutcome({ success: true, ttfvMinutes: 10 });
    }
    recordIncidentDrill({ sev: 'SEV-2', responseMinutes: 30, source: 'drill' });

    const report = buildReleaseReadinessReport({
      cwd: fixture.cwd,
      acceptanceReportPath: fixture.acceptancePath,
      auditLogPath: fixture.auditPath,
      releaseChannel: 'beta',
      securityScan: { status: 'pass', detail: 'ok' },
    });

    expect(report.status).toBe('pass');
    expect(report.summary.fail).toBe(0);
    expect(report.summary.warn).toBe(0);
    expect(report.scorePercent).toBeGreaterThanOrEqual(95);
  });

  it('returns warn when operational evidence is missing but hard failures are absent', () => {
    const fixture = createWorkspaceFixture();
    process.env.MATRIX_ONBOARDING_METRICS_PATH = join(fixture.cwd, 'onboarding-empty.json');
    process.env.MATRIX_INCIDENT_LOG_PATH = join(fixture.cwd, 'incidents-empty.json');

    const report = buildReleaseReadinessReport({
      cwd: fixture.cwd,
      acceptanceReportPath: fixture.acceptancePath,
      auditLogPath: join(fixture.cwd, 'missing-audit.jsonl'),
      releaseChannel: 'beta',
      securityScan: { status: 'pass', detail: 'ok' },
    });

    expect(report.status).toBe('warn');
    expect(report.summary.fail).toBe(0);
    const onboardingCheck = report.checks.find((check) => check.id === 'onboarding_release_gate');
    expect(onboardingCheck?.status).toBe('warn');
  });
});
