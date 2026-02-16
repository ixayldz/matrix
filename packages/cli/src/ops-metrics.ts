import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export type TelemetryMode = 'off' | 'minimal' | 'diagnostic';

type Primitive = string | number | boolean | null;

const BASE_ALLOWLIST = new Set([
  'command',
  'status',
  'durationMs',
  'exitCode',
  'errorCode',
  'provider',
  'model',
  'platform',
  'version',
  'channel',
  'eventCategory',
  'reason',
]);

const DIAGNOSTIC_ALLOWLIST = new Set([
  ...BASE_ALLOWLIST,
  'latencyMs',
  'retryCount',
  'tokensInput',
  'tokensOutput',
  'tokensTotal',
]);

const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /prompt/i,
  /content/i,
  /code/i,
  /diff/i,
  /source/i,
  /message/i,
  /payload/i,
];

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bapi[_-]?key\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/gi,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/gi,
  /\bpassword\b\s*[:=]\s*["']?[^"'\s]{8,}/gi,
];

function redactString(input: string): string {
  let value = input;
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, '***REDACTED***');
  }
  if (value.length > 256) {
    return `${value.slice(0, 253)}...`;
  }
  return value;
}

function shouldAllowKey(key: string, mode: TelemetryMode): boolean {
  if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return false;
  }

  const allowlist = mode === 'diagnostic' ? DIAGNOSTIC_ALLOWLIST : BASE_ALLOWLIST;
  return allowlist.has(key);
}

function normalizePrimitive(value: unknown): Primitive | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
  mode: TelemetryMode
): Record<string, Primitive> {
  const sanitized: Record<string, Primitive> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!shouldAllowKey(key, mode)) {
      continue;
    }
    const normalized = normalizePrimitive(value);
    if (normalized !== undefined) {
      sanitized[key] = normalized;
    }
  }

  return sanitized;
}

export interface AnalyticsEnvelope {
  event: string;
  timestamp: string;
  mode: Exclude<TelemetryMode, 'off'>;
  properties: Record<string, Primitive>;
}

export function createAnalyticsEnvelope(
  event: string,
  properties: Record<string, unknown>,
  mode: TelemetryMode
): { enabled: boolean; reason?: string; payload?: AnalyticsEnvelope } {
  if (mode === 'off') {
    return {
      enabled: false,
      reason: 'telemetry_off',
    };
  }

  return {
    enabled: true,
    payload: {
      event,
      timestamp: new Date().toISOString(),
      mode,
      properties: sanitizeAnalyticsProperties(properties, mode),
    },
  };
}

export function detectTelemetryLeak(payload: AnalyticsEnvelope): string[] {
  const issues: string[] = [];

  for (const [key, value] of Object.entries(payload.properties)) {
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      issues.push(`forbidden_key:${key}`);
      continue;
    }
    if (typeof value === 'string') {
      for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(value)) {
          issues.push(`secret_pattern:${key}`);
        }
      }
    }
  }

  return issues;
}

export interface TelemetrySelfTestReport {
  pass: boolean;
  mode: TelemetryMode;
  checks: Array<{ id: string; pass: boolean; message: string }>;
}

export function runTelemetrySelfTest(mode: TelemetryMode): TelemetrySelfTestReport {
  const checks: TelemetrySelfTestReport['checks'] = [];
  const syntheticKey = 'sk-' + 'abcdefghijklmnopqrstuvwxyz123456';
  const sample = createAnalyticsEnvelope(
    'self-test',
    {
      command: 'run',
      prompt: 'full user prompt should never be collected',
      content: 'full model response should never be collected',
      api_key: syntheticKey,
      reason: 'synthetic',
      durationMs: 123,
      tokensTotal: 999,
    },
    mode
  );

  if (mode === 'off') {
    checks.push({
      id: 'off_disables_analytics',
      pass: sample.enabled === false,
      message: sample.enabled ? 'Telemetry off still produced payload.' : 'Telemetry off disables analytics payload.',
    });
  } else {
    checks.push({
      id: 'analytics_enabled',
      pass: sample.enabled === true && sample.payload !== undefined,
      message: sample.enabled ? 'Payload generated for telemetry mode.' : 'Payload missing for telemetry mode.',
    });

    if (sample.payload) {
      const leakIssues = detectTelemetryLeak(sample.payload);
      checks.push({
        id: 'no_secret_leak',
        pass: leakIssues.length === 0,
        message: leakIssues.length === 0 ? 'No telemetry leaks detected.' : `Leak issues: ${leakIssues.join(', ')}`,
      });
      checks.push({
        id: 'forbidden_fields_filtered',
        pass: !('prompt' in sample.payload.properties) && !('content' in sample.payload.properties),
        message: 'Prompt/content fields are excluded from analytics payload.',
      });
      if (mode === 'minimal') {
        checks.push({
          id: 'minimal_excludes_diagnostic_tokens',
          pass: !('tokensTotal' in sample.payload.properties),
          message: 'Minimal mode excludes diagnostic token counters.',
        });
      }
    }
  }

  return {
    pass: checks.every((check) => check.pass),
    mode,
    checks,
  };
}

export interface OnboardingRecord {
  timestamp: string;
  success: boolean;
  ttfvMinutes?: number;
  platform?: string;
  notes?: string;
}

export interface OnboardingMetrics {
  attempts: number;
  successes: number;
  updatedAt: string;
  history: OnboardingRecord[];
}

function getMetricsDir(): string {
  return join(homedir(), '.matrix', 'metrics');
}

export function getOnboardingMetricsPath(): string {
  const override = process.env.MATRIX_ONBOARDING_METRICS_PATH;
  if (override && override.trim().length > 0) {
    return override;
  }
  return join(getMetricsDir(), 'onboarding.json');
}

function readJSON<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) {
      return fallback;
    }
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(path: string, value: unknown): void {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash > 0) {
    const dir = path.slice(0, lastSlash);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export function loadOnboardingMetrics(path = getOnboardingMetricsPath()): OnboardingMetrics {
  return readJSON<OnboardingMetrics>(path, {
    attempts: 0,
    successes: 0,
    updatedAt: new Date(0).toISOString(),
    history: [],
  });
}

export function recordOnboardingOutcome(
  record: { success: boolean; ttfvMinutes?: number; platform?: string; notes?: string },
  path = getOnboardingMetricsPath()
): OnboardingMetrics {
  const current = loadOnboardingMetrics(path);
  const now = new Date().toISOString();
  const nextRecord: OnboardingRecord = {
    timestamp: now,
    success: record.success,
    ...(record.ttfvMinutes !== undefined ? { ttfvMinutes: record.ttfvMinutes } : {}),
    ...(record.platform !== undefined ? { platform: record.platform } : {}),
    ...(record.notes !== undefined ? { notes: record.notes } : {}),
  };

  const next: OnboardingMetrics = {
    attempts: current.attempts + 1,
    successes: current.successes + (record.success ? 1 : 0),
    updatedAt: now,
    history: [...current.history, nextRecord].slice(-500),
  };
  writeJSON(path, next);
  return next;
}

export interface OnboardingSummary {
  attempts: number;
  successes: number;
  successRate: number;
  targetRate: number;
  pass: boolean;
  medianTtfvMinutes?: number;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function summarizeOnboardingMetrics(
  metrics: OnboardingMetrics,
  targetRate = 0.8
): OnboardingSummary {
  const successRate = metrics.attempts > 0 ? metrics.successes / metrics.attempts : 0;
  const ttfv = metrics.history
    .map((entry) => entry.ttfvMinutes)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return {
    attempts: metrics.attempts,
    successes: metrics.successes,
    successRate,
    targetRate,
    pass: successRate >= targetRate,
    ...(ttfv.length > 0 ? { medianTtfvMinutes: median(ttfv) } : {}),
  };
}

export type SevLevel = 'SEV-1' | 'SEV-2' | 'SEV-3';
export type IncidentSource = 'drill' | 'real';

export interface IncidentDrillRecord {
  id: string;
  sev: SevLevel;
  source: IncidentSource;
  createdAt: string;
  startedAt: string;
  firstUserUpdateAt: string;
  responseMinutes: number;
}

interface IncidentStore {
  records: IncidentDrillRecord[];
  updatedAt: string;
}

const FIRST_RESPONSE_TARGETS: Record<SevLevel, number> = {
  'SEV-1': 30,
  'SEV-2': 240,
  'SEV-3': 24 * 60,
};

export function getIncidentLogPath(): string {
  const override = process.env.MATRIX_INCIDENT_LOG_PATH;
  if (override && override.trim().length > 0) {
    return override;
  }
  return join(getMetricsDir(), 'incidents.json');
}

function loadIncidentStore(path = getIncidentLogPath()): IncidentStore {
  return readJSON<IncidentStore>(path, {
    records: [],
    updatedAt: new Date(0).toISOString(),
  });
}

function saveIncidentStore(store: IncidentStore, path = getIncidentLogPath()): void {
  writeJSON(path, store);
}

export function recordIncidentDrill(
  input: { sev: SevLevel; source?: IncidentSource; responseMinutes: number; startedAt?: string; firstUserUpdateAt?: string },
  path = getIncidentLogPath()
): IncidentDrillRecord {
  const now = new Date();
  const responseMinutes = Math.max(0, input.responseMinutes);
  const startedAt = input.startedAt ?? new Date(now.getTime() - responseMinutes * 60_000).toISOString();
  const firstUserUpdateAt = input.firstUserUpdateAt ?? now.toISOString();
  const record: IncidentDrillRecord = {
    id: randomUUID(),
    sev: input.sev,
    source: input.source ?? 'drill',
    createdAt: now.toISOString(),
    startedAt,
    firstUserUpdateAt,
    responseMinutes,
  };
  const store = loadIncidentStore(path);
  store.records = [...store.records, record].slice(-1000);
  store.updatedAt = now.toISOString();
  saveIncidentStore(store, path);
  return record;
}

export function loadIncidentRecords(path = getIncidentLogPath()): IncidentDrillRecord[] {
  return loadIncidentStore(path).records;
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export interface IncidentSlaSummary {
  sev: SevLevel;
  targetMinutes: number;
  total: number;
  metSla: number;
  pass: boolean;
  p95Minutes?: number;
  maxMinutes?: number;
}

export function summarizeIncidentSla(
  records: IncidentDrillRecord[],
  sev: SevLevel
): IncidentSlaSummary {
  const filtered = records.filter((record) => record.sev === sev);
  const targetMinutes = FIRST_RESPONSE_TARGETS[sev];
  const responseTimes = filtered.map((record) => record.responseMinutes).filter((value) => Number.isFinite(value));
  const metSla = filtered.filter((record) => record.responseMinutes <= targetMinutes).length;

  return {
    sev,
    targetMinutes,
    total: filtered.length,
    metSla,
    pass: filtered.length > 0 && metSla === filtered.length,
    ...(responseTimes.length > 0 ? { p95Minutes: percentile(responseTimes, 95), maxMinutes: Math.max(...responseTimes) } : {}),
  };
}
