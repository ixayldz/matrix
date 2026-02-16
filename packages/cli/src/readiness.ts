import { existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { homedir } from 'os';
import {
  loadIncidentRecords,
  loadOnboardingMetrics,
  runTelemetrySelfTest,
  summarizeIncidentSla,
  summarizeOnboardingMetrics,
  type TelemetryMode,
} from './ops-metrics.js';

type GateStatus = 'pass' | 'warn' | 'fail';

interface GateCheck {
  id: string;
  title: string;
  required: boolean;
  status: GateStatus;
  detail: string;
  remediation?: string;
}

interface SecurityScanCheck {
  status: GateStatus;
  detail: string;
}

interface AcceptanceAssertion {
  title?: string;
  status?: string;
}

interface AcceptanceTestResult {
  assertionResults?: AcceptanceAssertion[];
}

interface AcceptanceReport {
  success?: boolean;
  numFailedTests?: number;
  numPassedTests?: number;
  testResults?: AcceptanceTestResult[];
}

interface AcceptanceSummary {
  available: boolean;
  success: boolean;
  failedTests: number;
  passedTests: number;
  k10?: boolean;
  k16?: boolean;
}

interface AuditEvent {
  timestamp?: string;
  type?: string;
  status?: string;
}

interface ReadinessSummary {
  pass: number;
  warn: number;
  fail: number;
  total: number;
}

export interface ReadinessReport {
  generatedAt: string;
  status: GateStatus;
  scorePercent: number;
  summary: ReadinessSummary;
  requiredSummary: ReadinessSummary;
  checks: GateCheck[];
  nextActions: string[];
}

export interface ReadinessOptions {
  cwd?: string;
  telemetryMode?: TelemetryMode;
  releaseChannel?: string;
  acceptanceReportPath?: string;
  auditLogPath?: string;
  onboardingTargetRate?: number;
  gaTargetRate?: number;
  securityScan?: SecurityScanCheck;
  now?: Date;
}

function readJsonSafe<T>(path: string): T | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function collectAssertions(report: AcceptanceReport): AcceptanceAssertion[] {
  const testResults = Array.isArray(report.testResults) ? report.testResults : [];
  return testResults.flatMap((result) =>
    Array.isArray(result.assertionResults) ? result.assertionResults : []
  );
}

function findGateStatus(assertions: AcceptanceAssertion[], gateId: string): boolean | undefined {
  const target = assertions.find((item) =>
    typeof item.title === 'string' && new RegExp(`\\b${gateId}\\b`).test(item.title)
  );
  if (!target) {
    return undefined;
  }
  return target.status === 'passed';
}

function loadAcceptanceSummary(path: string): AcceptanceSummary {
  const report = readJsonSafe<AcceptanceReport>(path);
  if (!report) {
    return {
      available: false,
      success: false,
      failedTests: 0,
      passedTests: 0,
    };
  }

  const assertions = collectAssertions(report);
  return {
    available: true,
    success: report.success === true && (report.numFailedTests ?? 0) === 0,
    failedTests: report.numFailedTests ?? 0,
    passedTests: report.numPassedTests ?? 0,
    k10: findGateStatus(assertions, 'K10'),
    k16: findGateStatus(assertions, 'K16'),
  };
}

function loadAuditEvents(path: string): AuditEvent[] {
  try {
    if (!existsSync(path)) {
      return [];
    }
    const content = readFileSync(path, 'utf-8');
    if (!content.trim()) {
      return [];
    }
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}

function hasRecentReleaseOps(events: AuditEvent[], now: Date): boolean {
  const threshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp ?? '');
    return Number.isFinite(timestamp) && timestamp >= threshold;
  });
  const hasUpdate = recent.some((event) => event.type === 'release.update' && event.status === 'success');
  const hasRollback = recent.some(
    (event) => event.type === 'release.rollback' && event.status === 'success'
  );
  return hasUpdate && hasRollback;
}

function validateCiMatrix(cwd: string): { osMatrix: boolean; updateRollbackSmoke: boolean } {
  const ciFile = join(cwd, '.github', 'workflows', 'ci.yml');
  if (!existsSync(ciFile)) {
    return {
      osMatrix: false,
      updateRollbackSmoke: false,
    };
  }

  const content = readFileSync(ciFile, 'utf-8');
  const osMatrix = ['ubuntu-latest', 'windows-latest', 'macos-latest'].every((platform) =>
    content.includes(platform)
  );
  const updateRollbackSmoke =
    /update --channel .*--check/.test(content) && /update --rollback/.test(content);

  return { osMatrix, updateRollbackSmoke };
}

function checkOnboardingDocs(cwd: string): { pass: boolean; missing: string[] } {
  const required = [
    join(cwd, 'docs', 'onboarding', 'quickstart.md'),
    join(cwd, 'docs', 'onboarding', 'provider-keys.md'),
    join(cwd, 'docs', 'onboarding', 'doctor-troubleshooting.md'),
    join(cwd, 'docs', 'onboarding', 'known-limitations.md'),
  ];
  const missing = required.filter((path) => !existsSync(path)).map((path) => relative(cwd, path));
  return {
    pass: missing.length === 0,
    missing,
  };
}

function summarizeChecks(checks: GateCheck[]): ReadinessSummary {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    total: checks.length,
  };
}

function score(summary: ReadinessSummary): number {
  if (summary.total === 0) {
    return 0;
  }
  const weighted = summary.pass + summary.warn * 0.5;
  return Math.round((weighted / summary.total) * 100);
}

function deriveOverallStatus(summary: ReadinessSummary): GateStatus {
  if (summary.fail > 0) {
    return 'fail';
  }
  if (summary.warn > 0) {
    return 'warn';
  }
  return 'pass';
}

function defaultAcceptanceReportPath(cwd: string): string {
  return join(cwd, 'packages', 'acceptance', 'acceptance-report.json');
}

function defaultAuditLogPath(): string {
  return join(homedir(), '.matrix', 'audit', 'events.jsonl');
}

export function buildReleaseReadinessReport(options: ReadinessOptions = {}): ReadinessReport {
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const acceptancePath = options.acceptanceReportPath ?? defaultAcceptanceReportPath(cwd);
  const auditPath = options.auditLogPath ?? defaultAuditLogPath();
  const releaseChannel = (options.releaseChannel ?? 'beta').toLowerCase();
  const onboardingTargetRate = options.onboardingTargetRate ?? 0.8;
  const gaTargetRate = options.gaTargetRate ?? 0.85;

  const checks: GateCheck[] = [];

  const acceptance = loadAcceptanceSummary(acceptancePath);
  checks.push({
    id: 'acceptance_automation',
    title: 'Acceptance automation report',
    required: true,
    status: acceptance.available
      ? acceptance.success
        ? 'pass'
        : 'fail'
      : 'fail',
    detail: acceptance.available
      ? `Passed tests: ${acceptance.passedTests}, failed tests: ${acceptance.failedTests}.`
      : `Acceptance report missing at ${acceptancePath}.`,
    remediation: acceptance.available
      ? acceptance.success
        ? undefined
        : 'Run acceptance suite and fix failing gates: pnpm --filter @matrix/acceptance test'
      : 'Generate report: pnpm --filter @matrix/acceptance run test:report',
  });

  const telemetryOff = runTelemetrySelfTest('off');
  checks.push({
    id: 'telemetry_off_zero_leak',
    title: 'Telemetry off zero-leak contract',
    required: true,
    status: telemetryOff.pass ? 'pass' : 'fail',
    detail: telemetryOff.pass
      ? 'Telemetry off mode blocks analytics payload generation.'
      : telemetryOff.checks
          .filter((check) => !check.pass)
          .map((check) => check.message)
          .join(' | '),
    remediation: telemetryOff.pass ? undefined : 'Review telemetry sanitizer and allowlist settings.',
  });

  const onboarding = summarizeOnboardingMetrics(loadOnboardingMetrics(), onboardingTargetRate);
  checks.push({
    id: 'onboarding_release_gate',
    title: `Onboarding success gate >= ${(onboardingTargetRate * 100).toFixed(0)}%`,
    required: true,
    status:
      onboarding.attempts === 0 ? 'warn' : onboarding.pass ? 'pass' : 'fail',
    detail:
      onboarding.attempts === 0
        ? 'No onboarding attempts recorded yet.'
        : `${(onboarding.successRate * 100).toFixed(1)}% (${onboarding.successes}/${onboarding.attempts}).`,
    remediation:
      onboarding.attempts === 0
        ? 'Record attempts: matrix onboarding record --success --ttfv-minutes 10'
        : onboarding.pass
          ? undefined
          : 'Improve onboarding flow and retest until gate reaches target.',
  });

  const gaOnboarding = summarizeOnboardingMetrics(loadOnboardingMetrics(), gaTargetRate);
  checks.push({
    id: 'onboarding_ga_gate',
    title: `GA onboarding gate >= ${(gaTargetRate * 100).toFixed(0)}%`,
    required: false,
    status:
      gaOnboarding.attempts === 0 ? 'warn' : gaOnboarding.pass ? 'pass' : 'warn',
    detail:
      gaOnboarding.attempts === 0
        ? 'No onboarding attempts recorded yet.'
        : `${(gaOnboarding.successRate * 100).toFixed(1)}% (${gaOnboarding.successes}/${gaOnboarding.attempts}).`,
    remediation:
      gaOnboarding.attempts === 0 || !gaOnboarding.pass
        ? 'Target for GA is >=85% onboarding success over rolling window.'
        : undefined,
  });

  const sev2 = summarizeIncidentSla(loadIncidentRecords(), 'SEV-2');
  checks.push({
    id: 'sev2_first_update_sla',
    title: 'SEV-2 first user update <= 4 hours',
    required: true,
    status: sev2.total === 0 ? 'warn' : sev2.pass ? 'pass' : 'fail',
    detail:
      sev2.total === 0
        ? 'No SEV-2 drill records found.'
        : `${sev2.metSla}/${sev2.total} incidents met <= ${sev2.targetMinutes} minutes.`,
    remediation:
      sev2.total === 0
        ? 'Run drill: matrix incident drill --sev SEV-2 --response-minutes 30'
        : sev2.pass
          ? undefined
          : 'Reduce first-user-update latency and re-run incident drills.',
  });

  checks.push({
    id: 'release_channel_default',
    title: 'Default release channel is beta for public beta',
    required: true,
    status: releaseChannel === 'beta' ? 'pass' : 'fail',
    detail: `Current release channel: ${releaseChannel}.`,
    remediation:
      releaseChannel === 'beta'
        ? undefined
        : 'Switch to beta: matrix update --channel beta --check',
  });

  const ciMatrix = validateCiMatrix(cwd);
  checks.push({
    id: 'cross_platform_ci',
    title: 'CI matrix includes Windows/macOS/Linux',
    required: true,
    status: ciMatrix.osMatrix ? 'pass' : 'fail',
    detail: ciMatrix.osMatrix
      ? 'CI matrix includes ubuntu-latest, windows-latest, macos-latest.'
      : 'CI matrix does not cover all required operating systems.',
    remediation: ciMatrix.osMatrix
      ? undefined
      : 'Update .github/workflows/ci.yml to include all required OS targets.',
  });

  checks.push({
    id: 'update_rollback_smoke',
    title: 'Update + rollback smoke checks are in CI',
    required: true,
    status: ciMatrix.updateRollbackSmoke ? 'pass' : 'fail',
    detail: ciMatrix.updateRollbackSmoke
      ? 'CI contains update --check and update --rollback smoke commands.'
      : 'CI workflow is missing update/rollback smoke checks.',
    remediation: ciMatrix.updateRollbackSmoke
      ? undefined
      : 'Add update --check and update --rollback steps to CI workflow.',
  });

  const docs = checkOnboardingDocs(cwd);
  checks.push({
    id: 'onboarding_docs_package',
    title: 'Onboarding document package is complete',
    required: true,
    status: docs.pass ? 'pass' : 'fail',
    detail: docs.pass
      ? 'Required onboarding docs exist.'
      : `Missing docs: ${docs.missing.join(', ')}`,
    remediation: docs.pass
      ? undefined
      : 'Add required docs under docs/onboarding/*.md',
  });

  if (!acceptance.available) {
    checks.push({
      id: 'acceptance_k10_redaction',
      title: 'Run export redaction gate (K10)',
      required: true,
      status: 'warn',
      detail: 'Cannot validate K10 without acceptance report.',
      remediation: 'Generate and review acceptance report.',
    });
  } else {
    checks.push({
      id: 'acceptance_k10_redaction',
      title: 'Run export redaction gate (K10)',
      required: true,
      status: acceptance.k10 === true ? 'pass' : 'fail',
      detail:
        acceptance.k10 === true
          ? 'K10 passed in acceptance report.'
          : 'K10 did not pass in acceptance report.',
      remediation:
        acceptance.k10 === true ? undefined : 'Fix export redaction flow and rerun acceptance tests.',
    });
  }

  if (!acceptance.available) {
    checks.push({
      id: 'acceptance_k16_quota',
      title: 'Quota hard-limit contract gate (K16)',
      required: true,
      status: 'warn',
      detail: 'Cannot validate K16 without acceptance report.',
      remediation: 'Generate and review acceptance report.',
    });
  } else {
    checks.push({
      id: 'acceptance_k16_quota',
      title: 'Quota hard-limit contract gate (K16)',
      required: true,
      status: acceptance.k16 === true ? 'pass' : 'fail',
      detail:
        acceptance.k16 === true
          ? 'K16 passed in acceptance report.'
          : 'K16 did not pass in acceptance report.',
      remediation:
        acceptance.k16 === true ? undefined : 'Fix quota behavior and rerun acceptance tests.',
    });
  }

  const auditEvents = loadAuditEvents(auditPath);
  const recentOps = hasRecentReleaseOps(auditEvents, now);
  checks.push({
    id: 'release_audit_drill',
    title: 'Recent successful update + rollback audit events',
    required: false,
    status: recentOps ? 'pass' : auditEvents.length === 0 ? 'warn' : 'warn',
    detail: recentOps
      ? 'Found successful release.update and release.rollback events in last 30 days.'
      : auditEvents.length === 0
        ? `No audit events found at ${auditPath}.`
        : 'Recent successful update+rollback pair not found in audit log.',
    remediation: recentOps
      ? undefined
      : 'Run update and rollback drills to generate audit evidence.',
  });

  const securityScan = options.securityScan;
  checks.push({
    id: 'security_scan',
    title: 'Security scan passes with no critical findings',
    required: true,
    status: securityScan?.status ?? 'warn',
    detail: securityScan?.detail ?? 'Security scan not executed in readiness command context.',
    remediation:
      securityScan?.status === 'pass'
        ? undefined
        : 'Run security scan and resolve findings: pnpm security:scan',
  });

  const summary = summarizeChecks(checks);
  const requiredSummary = summarizeChecks(checks.filter((check) => check.required));
  const readinessStatus = deriveOverallStatus(requiredSummary);
  const nextActions = checks
    .filter((check) => check.status !== 'pass' && check.remediation)
    .map((check) => `${check.id}: ${check.remediation}`);

  return {
    generatedAt: now.toISOString(),
    status: readinessStatus,
    scorePercent: score(requiredSummary),
    summary,
    requiredSummary,
    checks,
    nextActions,
  };
}
