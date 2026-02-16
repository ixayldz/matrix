import { exec } from '../exec/index.js';
import type { ToolResult } from '@matrix/core';

/**
 * Test framework types
 */
export type TestFramework = 'jest' | 'vitest' | 'mocha' | 'unknown';

/**
 * Test result
 */
export interface TestRunResult {
  framework: TestFramework;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  duration: number;
  coverage?: number;
  tests: TestResult[];
  stdout: string;
  stderr: string;
}

/**
 * Individual test result
 */
export interface TestResult {
  name: string;
  suite?: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number;
  error?: string;
  errorStack?: string;
}

/**
 * Detect test framework
 */
export async function detectTestFramework(workingDir: string): Promise<TestFramework> {
  // Check for vitest
  const vitestResult = await exec('npx', ['vitest', '--version'], { cwd: workingDir, reject: false });
  if (vitestResult.success && vitestResult.data?.exitCode === 0) {
    return 'vitest';
  }

  // Check for jest
  const jestResult = await exec('npx', ['jest', '--version'], { cwd: workingDir, reject: false });
  if (jestResult.success && jestResult.data?.exitCode === 0) {
    return 'jest';
  }

  // Check for mocha
  const mochaResult = await exec('npx', ['mocha', '--version'], { cwd: workingDir, reject: false });
  if (mochaResult.success && mochaResult.data?.exitCode === 0) {
    return 'mocha';
  }

  return 'unknown';
}

/**
 * Run tests
 */
export async function runTests(
  workingDir: string,
  options: {
    framework?: TestFramework;
    pattern?: string;
    coverage?: boolean;
    watch?: boolean;
    updateSnapshot?: boolean;
  } = {}
): Promise<ToolResult<TestRunResult>> {
  const {
    framework,
    pattern,
    coverage = false,
    watch = false,
    updateSnapshot = false,
  } = options;

  try {
    // Detect framework if not specified
    const detectedFramework = framework ?? (await detectTestFramework(workingDir));

    if (detectedFramework === 'unknown') {
      return {
        success: false,
        error: 'Could not detect test framework. Please install jest, vitest, or mocha.',
      };
    }

    // Build command based on framework
    const { command, args } = buildTestCommand(detectedFramework, {
      ...(pattern !== undefined ? { pattern } : {}),
      coverage,
      watch,
      updateSnapshot,
    });

    const startTime = Date.now();
    const result = await exec(command, args, {
      cwd: workingDir,
      timeout: 300000, // 5 minutes
      reject: false,
    });
    const duration = Date.now() - startTime;

    // Parse results
    const parsedResult = parseTestOutput(detectedFramework, result.data ?? {
      stdout: '',
      stderr: '',
      exitCode: result.success ? 0 : 1,
      failed: !result.success,
      timedOut: false,
      command: '',
      duration,
    });

    return {
      success: result.success,
      data: parsedResult,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error running tests',
    };
  }
}

/**
 * Build test command for framework
 */
function buildTestCommand(
  framework: TestFramework,
  options: {
    pattern?: string;
    coverage?: boolean;
    watch?: boolean;
    updateSnapshot?: boolean;
  }
): { command: string; args: string[] } {
  const { pattern, coverage, watch, updateSnapshot } = options;

  switch (framework) {
    case 'vitest': {
      const args = ['vitest', 'run'];
      if (pattern) args.push(pattern);
      if (coverage) args.push('--coverage');
      if (watch) args[1] = 'watch'; // Replace 'run' with 'watch'
      return { command: 'npx', args };
    }

    case 'jest': {
      const args = ['jest', '--ci', '--json'];
      if (pattern) args.push('--testPathPattern', pattern);
      if (coverage) args.push('--coverage');
      if (watch) args.push('--watch');
      if (updateSnapshot) args.push('--updateSnapshot');
      return { command: 'npx', args };
    }

    case 'mocha': {
      const args = ['mocha', '--reporter', 'json'];
      if (pattern) args.push('--grep', pattern);
      if (watch) args.push('--watch');
      return { command: 'npx', args };
    }

    default:
      return { command: 'npx', args: ['test'] };
  }
}

/**
 * Parse test output based on framework
 */
function parseTestOutput(
  framework: TestFramework,
  result: { stdout: string; stderr: string; exitCode: number; duration: number }
): TestRunResult {
  const base: TestRunResult = {
    framework,
    passed: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    duration: result.duration,
    tests: [],
    stdout: result.stdout,
    stderr: result.stderr,
  };

  try {
    switch (framework) {
      case 'vitest':
        return parseVitestOutput(result.stdout, base);

      case 'jest':
        return parseJestOutput(result.stdout, base);

      case 'mocha':
        return parseMochaOutput(result.stdout, base);

      default:
        return base;
    }
  } catch {
    return base;
  }
}

/**
 * Parse Vitest output
 */
function parseVitestOutput(stdout: string, base: TestRunResult): TestRunResult {
  // Try to parse JSON output
  try {
    // Look for JSON summary
    const jsonMatch = stdout.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      for (const testResult of parsed.testResults ?? []) {
        for (const assertion of testResult.assertionResults ?? []) {
          base.tests.push({
            name: assertion.title,
            suite: assertion.ancestorTitles?.join(' > '),
            status: mapStatus(assertion.status),
            duration: assertion.duration ?? 0,
            error: assertion.failureMessages?.join('\n'),
          });

          if (assertion.status === 'passed') base.passed++;
          else if (assertion.status === 'failed') base.failed++;
          else if (assertion.status === 'skipped' || assertion.status === 'pending') base.skipped++;
        }
      }
    }
  } catch {
    // Fallback to regex parsing
    const passMatch = stdout.match(/(\d+) passed/);
    const failMatch = stdout.match(/(\d+) failed/);
    const skipMatch = stdout.match(/(\d+) skipped/);

    if (passMatch) base.passed = parseInt(passMatch[1] ?? '0', 10);
    if (failMatch) base.failed = parseInt(failMatch[1] ?? '0', 10);
    if (skipMatch) base.skipped = parseInt(skipMatch[1] ?? '0', 10);
  }

  return base;
}

/**
 * Parse Jest output
 */
function parseJestOutput(stdout: string, base: TestRunResult): TestRunResult {
  try {
    // Jest outputs JSON when --json flag is used
    const parsed = JSON.parse(stdout);

    for (const testResult of parsed.testResults ?? []) {
      for (const assertion of testResult.assertionResults ?? []) {
        base.tests.push({
          name: assertion.title,
          suite: assertion.ancestorTitles?.join(' > '),
          status: mapStatus(assertion.status),
          duration: assertion.duration ?? 0,
          error: assertion.failureMessages?.join('\n'),
        });
      }
    }

    base.passed = parsed.numPassedTests ?? 0;
    base.failed = parsed.numFailedTests ?? 0;
    base.skipped = parsed.numPendingTests ?? 0;
    base.pending = parsed.numTodoTests ?? 0;
    if (parsed.coverageMap) {
      base.coverage = calculateCoverage(parsed.coverageMap);
    }
  } catch {
    // Fallback
  }

  return base;
}

/**
 * Parse Mocha output
 */
function parseMochaOutput(stdout: string, base: TestRunResult): TestRunResult {
  try {
    const parsed = JSON.parse(stdout);

    for (const test of parsed.tests ?? []) {
      base.tests.push({
        name: test.title,
        suite: test.fullTitle?.replace(test.title, '').trim(),
        status: test.pending ? 'pending' : test.err ? 'failed' : 'passed',
        duration: test.duration ?? 0,
        error: test.err?.message,
        errorStack: test.err?.stack,
      });
    }

    base.passed = parsed.stats?.passes ?? 0;
    base.failed = parsed.stats?.failures ?? 0;
    base.skipped = parsed.stats?.skipped ?? 0;
    base.pending = parsed.stats?.pending ?? 0;
    base.duration = parsed.stats?.duration ?? base.duration;
  } catch {
    // Fallback
  }

  return base;
}

/**
 * Map status string to TestResult status
 */
function mapStatus(status: string): TestResult['status'] {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'pending':
    case 'todo':
      return 'skipped';
    default:
      return 'passed';
  }
}

/**
 * Calculate coverage percentage
 */
function calculateCoverage(_coverageMap: Record<string, unknown>): number {
  // Simplified coverage calculation
  return 0;
}
