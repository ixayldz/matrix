import { exec } from '../exec/index.js';
import { fsExists } from '../fs/index.js';
import type { ToolResult } from '@matrix/core';

/**
 * Lint severity levels
 */
export type LintSeverity = 'error' | 'warn' | 'info' | 'off';

/**
 * Lint options
 */
export interface LintOptions {
  cwd?: string;
  fix?: boolean;
  config?: string;
  ignorePath?: string;
  maxWarnings?: number;
  format?: 'json' | 'stylish' | 'compact' | 'unix';
}

/**
 * Individual lint issue
 */
export interface LintIssue {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  rule: string;
  message: string;
  severity: LintSeverity;
  fixable?: boolean;
  suggestion?: string;
}

/**
 * File lint result
 */
export interface FileLintResult {
  filePath: string;
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
  issues: LintIssue[];
  source?: string;
}

/**
 * Batch lint result
 */
export interface BatchLintResult {
  files: FileLintResult[];
  totalFiles: number;
  totalErrors: number;
  totalWarnings: number;
  fixableErrors: number;
  fixableWarnings: number;
  duration: number;
  passed: boolean;
}

/**
 * Lint config info
 */
export interface LintConfig {
  configPath?: string;
  ignorePath?: string;
  version?: string;
  plugins?: string[];
}

/**
 * Detect ESLint configuration in project
 */
export async function getLintConfig(projectPath: string): Promise<ToolResult<LintConfig>> {
  try {
    const eslintConfigs = [
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      '.eslintrc.js',
      '.eslintrc.cjs',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
    ];

    for (const config of eslintConfigs) {
      if (await fsExists(`${projectPath}/${config}`)) {
        const version = await getESLintVersion(projectPath);
        const data: LintConfig = {
          configPath: `${projectPath}/${config}`,
        };
        if (version !== undefined) {
          data.version = version;
        }
        return {
          success: true,
          data,
        };
      }
    }

    // Check package.json for eslint config
    const pkgJsonPath = `${projectPath}/package.json`;
    if (await fsExists(pkgJsonPath)) {
      const pkgResult = await import('fs').then(fs =>
        fs.promises.readFile(pkgJsonPath, 'utf-8').catch(() => null)
      );
      if (pkgResult) {
        try {
          const pkg = JSON.parse(pkgResult);
          if (pkg.eslintConfig) {
            const version = await getESLintVersion(projectPath);
            const data: LintConfig = {
              configPath: pkgJsonPath,
            };
            if (version !== undefined) {
              data.version = version;
            }
            return {
              success: true,
              data,
            };
          }
        } catch {
          // Invalid JSON, continue
        }
      }
    }

    // Check for .eslintignore
    const ignorePath = await fsExists(`${projectPath}/.eslintignore`)
      ? `${projectPath}/.eslintignore`
      : undefined;

    const version = await getESLintVersion(projectPath);
    const data: LintConfig = {
      ...(ignorePath !== undefined ? { ignorePath } : {}),
    };
    if (version !== undefined) {
      data.version = version;
    }
    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error detecting lint config',
    };
  }
}

/**
 * Get ESLint version
 */
async function getESLintVersion(cwd: string): Promise<string | undefined> {
  try {
    const result = await exec('npx', ['eslint', '--version'], {
      cwd,
      timeout: 10000,
      reject: false,
    });
    if (result.success && result.data?.stdout) {
      return result.data.stdout.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lint a single file
 */
export async function lintFile(
  filePath: string,
  options: LintOptions = {}
): Promise<ToolResult<FileLintResult>> {
  const {
    cwd = process.cwd(),
    fix = false,
    config,
    ignorePath,
    maxWarnings = -1,
    format = 'json',
  } = options;
  const startTime = Date.now();

  try {
    // Build ESLint command
    const args = ['eslint', '--format', format, filePath];

    if (fix) {
      args.push('--fix');
    }
    if (config) {
      args.push('--config', config);
    }
    if (ignorePath) {
      args.push('--ignore-path', ignorePath);
    }
    if (maxWarnings >= 0) {
      args.push('--max-warnings', maxWarnings.toString());
    }

    const result = await exec('npx', args, {
      cwd,
      timeout: 60000,
      reject: false,
    });

    // Parse JSON output
    let lintResults: FileLintResult = {
      filePath,
      errorCount: 0,
      warningCount: 0,
      fixableErrorCount: 0,
      fixableWarningCount: 0,
      issues: [],
    };

    if (result.data?.stdout) {
      try {
        const parsed = JSON.parse(result.data.stdout);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const fileResult = parsed[0];
          lintResults = {
            filePath: fileResult.filePath || filePath,
            errorCount: fileResult.errorCount ?? 0,
            warningCount: fileResult.warningCount ?? 0,
            fixableErrorCount: fileResult.fixableErrorCount ?? 0,
            fixableWarningCount: fileResult.fixableWarningCount ?? 0,
            issues: (fileResult.messages || []).map((msg: Record<string, unknown>) => ({
              filePath: fileResult.filePath || filePath,
              line: msg.line ?? 1,
              column: msg.column ?? 1,
              endLine: msg.endLine as number | undefined,
              endColumn: msg.endColumn as number | undefined,
              rule: msg.ruleId as string || 'unknown',
              message: msg.message as string,
              severity: mapSeverity(msg.severity as number),
              fixable: !!msg.fix,
              suggestion: (msg.suggestions as Array<{ desc: string }>)?.[0]?.desc,
            })),
            source: fileResult.source,
          };
        }
      } catch {
        // JSON parse failed, return empty results
      }
    }

    // Success if no errors (warnings are ok unless maxWarnings exceeded)
    const hasErrors = lintResults.errorCount > 0;

    return {
      success: !hasErrors,
      data: lintResults,
      metadata: {
        duration: Date.now() - startTime,
        fixApplied: fix,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error linting file',
      data: {
        filePath,
        errorCount: 1,
        warningCount: 0,
        fixableErrorCount: 0,
        fixableWarningCount: 0,
        issues: [],
      },
    };
  }
}

/**
 * Lint multiple files matching a glob pattern
 */
export async function lintFiles(
  pattern: string,
  options: LintOptions = {}
): Promise<ToolResult<BatchLintResult>> {
  const {
    cwd = process.cwd(),
    fix = false,
    config,
    ignorePath,
    maxWarnings = -1,
    format = 'json',
  } = options;
  const startTime = Date.now();

  try {
    // Build ESLint command
    const args = ['eslint', '--format', format, pattern];

    if (fix) {
      args.push('--fix');
    }
    if (config) {
      args.push('--config', config);
    }
    if (ignorePath) {
      args.push('--ignore-path', ignorePath);
    }
    if (maxWarnings >= 0) {
      args.push('--max-warnings', maxWarnings.toString());
    }

    const result = await exec('npx', args, {
      cwd,
      timeout: 180000, // 3 minutes for batch
      reject: false,
    });

    // Parse JSON output
    const batchResult: BatchLintResult = {
      files: [],
      totalFiles: 0,
      totalErrors: 0,
      totalWarnings: 0,
      fixableErrors: 0,
      fixableWarnings: 0,
      duration: Date.now() - startTime,
      passed: result.success,
    };

    if (result.data?.stdout) {
      try {
        const parsed = JSON.parse(result.data.stdout);
        if (Array.isArray(parsed)) {
          for (const fileResult of parsed) {
            const fileLint: FileLintResult = {
              filePath: fileResult.filePath || 'unknown',
              errorCount: fileResult.errorCount ?? 0,
              warningCount: fileResult.warningCount ?? 0,
              fixableErrorCount: fileResult.fixableErrorCount ?? 0,
              fixableWarningCount: fileResult.fixableWarningCount ?? 0,
              issues: (fileResult.messages || []).map((msg: Record<string, unknown>) => ({
                filePath: fileResult.filePath || 'unknown',
                line: msg.line ?? 1,
                column: msg.column ?? 1,
                endLine: msg.endLine as number | undefined,
                endColumn: msg.endColumn as number | undefined,
                rule: msg.ruleId as string || 'unknown',
                message: msg.message as string,
                severity: mapSeverity(msg.severity as number),
                fixable: !!msg.fix,
                suggestion: (msg.suggestions as Array<{ desc: string }>)?.[0]?.desc,
              })),
              source: fileResult.source,
            };

            batchResult.files.push(fileLint);
            batchResult.totalFiles++;
            batchResult.totalErrors += fileLint.errorCount;
            batchResult.totalWarnings += fileLint.warningCount;
            batchResult.fixableErrors += fileLint.fixableErrorCount;
            batchResult.fixableWarnings += fileLint.fixableWarningCount;
          }
        }
      } catch {
        // JSON parse failed
      }
    }

    batchResult.passed = batchResult.totalErrors === 0;

    return {
      success: batchResult.passed,
      data: batchResult,
      metadata: {
        duration: batchResult.duration,
        fixApplied: fix,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error linting files',
      data: {
        files: [],
        totalFiles: 0,
        totalErrors: 1,
        totalWarnings: 0,
        fixableErrors: 0,
        fixableWarnings: 0,
        duration: Date.now() - startTime,
        passed: false,
      },
    };
  }
}

/**
 * Map ESLint severity number to string
 */
function mapSeverity(severity: number | undefined): LintSeverity {
  switch (severity) {
    case 2:
      return 'error';
    case 1:
      return 'warn';
    case 0:
      return 'off';
    default:
      return 'info';
  }
}
