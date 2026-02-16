import { exec } from '../exec/index.js';
import { fsRead, fsExists } from '../fs/index.js';
import type { ToolResult } from '@matrix/core';

/**
 * Formatter types
 */
export type FormatterType = 'prettier' | 'eslint' | 'unknown';

/**
 * Formatter options
 */
export interface FormatOptions {
  cwd?: string;
  check?: boolean;
  write?: boolean;
  config?: string;
  ignorePath?: string;
}

/**
 * Format result for a single file
 */
export interface FileFormatResult {
  filePath: string;
  formatted: boolean;
  changed: boolean;
  error?: string;
  originalSize?: number;
  formattedSize?: number;
}

/**
 * Batch format result
 */
export interface BatchFormatResult {
  files: FileFormatResult[];
  totalFiles: number;
  formattedCount: number;
  unchangedCount: number;
  errorCount: number;
  duration: number;
}

/**
 * Formatter config info
 */
export interface FormatterConfig {
  type: FormatterType;
  configPath?: string;
  ignorePath?: string;
  version?: string;
}

/**
 * Detect formatter configuration in project
 */
export async function getFormatterConfig(projectPath: string): Promise<ToolResult<FormatterConfig>> {
  try {
    // Check for Prettier config files
    const prettierConfigs = [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yaml',
      '.prettierrc.yml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      'prettier.config.js',
      'prettier.config.cjs',
    ];

    for (const config of prettierConfigs) {
      if (await fsExists(`${projectPath}/${config}`)) {
        const version = await getFormatterVersion('prettier', projectPath);
        const data: FormatterConfig = {
          type: 'prettier',
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

    // Check for package.json with prettier config
    const pkgJsonPath = `${projectPath}/package.json`;
    if (await fsExists(pkgJsonPath)) {
      const pkgResult = await fsRead(pkgJsonPath);
      if (pkgResult.success && pkgResult.data) {
        try {
          const pkg = JSON.parse(pkgResult.data);
          if (pkg.prettier) {
            const version = await getFormatterVersion('prettier', projectPath);
            const data: FormatterConfig = {
              type: 'prettier',
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

    // Check for ESLint config with formatting rules
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
        const version = await getFormatterVersion('eslint', projectPath);
        const data: FormatterConfig = {
          type: 'eslint',
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

    // Default to prettier if available
    const prettierVersion = await getFormatterVersion('prettier', projectPath);
    if (prettierVersion) {
      return {
        success: true,
        data: {
          type: 'prettier',
          version: prettierVersion,
        },
      };
    }

    return {
      success: true,
      data: {
        type: 'unknown',
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error detecting formatter config',
    };
  }
}

/**
 * Get formatter version
 */
async function getFormatterVersion(
  formatter: 'prettier' | 'eslint',
  cwd: string
): Promise<string | undefined> {
  try {
    const result = await exec('npx', [formatter, '--version'], {
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
 * Format a single file
 */
export async function formatFile(
  filePath: string,
  options: FormatOptions = {}
): Promise<ToolResult<FileFormatResult>> {
  const { cwd = process.cwd(), check = false, write = true, config, ignorePath } = options;
  const startTime = Date.now();

  try {
    // Detect formatter for this file
    const configResult = await getFormatterConfig(cwd);
    const formatterType = configResult.data?.type ?? 'prettier';

    // Build command based on formatter type
    let command: string;
    let args: string[];

    if (formatterType === 'eslint') {
      command = 'npx';
      args = ['eslint', '--fix', filePath];
      if (check) {
        args = ['eslint', filePath];
      }
    } else {
      command = 'npx';
      args = ['prettier'];
      if (write && !check) {
        args.push('--write');
      } else {
        args.push('--check');
      }
      args.push(filePath);
    }

    if (config) {
      args.push('--config', config);
    }
    if (ignorePath) {
      args.push('--ignore-path', ignorePath);
    }

    const result = await exec(command, args, {
      cwd,
      timeout: 30000,
      reject: false,
    });

    // Get file size info
    let originalSize: number | undefined;
    const readResult = await fsRead(filePath);
    if (readResult.success && readResult.data) {
      originalSize = readResult.data.length;
    }

    const formatResult: FileFormatResult = {
      filePath,
      formatted: result.success,
      changed: !check && result.success,
      ...(originalSize !== undefined
        ? {
            originalSize,
            formattedSize: originalSize, // Would need to re-read to get new size
          }
        : {}),
    };

    if (!result.success) {
      const errorMessage = result.data?.stderr || result.error;
      if (errorMessage !== undefined) {
        formatResult.error = errorMessage;
      }
    }

    return {
      success: result.success,
      data: formatResult,
      metadata: {
        formatter: formatterType,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error formatting file',
      data: {
        filePath,
        formatted: false,
        changed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * Format multiple files matching a glob pattern
 */
export async function formatFiles(
  pattern: string,
  options: FormatOptions = {}
): Promise<ToolResult<BatchFormatResult>> {
  const { cwd = process.cwd(), check = false, write = true, config, ignorePath } = options;
  const startTime = Date.now();

  try {
    // Detect formatter
    const configResult = await getFormatterConfig(cwd);
    const formatterType = configResult.data?.type ?? 'prettier';

    // Build command
    let command: string;
    let args: string[];

    if (formatterType === 'eslint') {
      command = 'npx';
      args = ['eslint', '--fix', pattern];
      if (check) {
        args = ['eslint', pattern];
      }
    } else {
      command = 'npx';
      args = ['prettier'];
      if (write && !check) {
        args.push('--write');
      } else {
        args.push('--check');
      }
      args.push(pattern);
    }

    if (config) {
      args.push('--config', config);
    }
    if (ignorePath) {
      args.push('--ignore-path', ignorePath);
    }

    const result = await exec(command, args, {
      cwd,
      timeout: 120000, // 2 minutes for batch
      reject: false,
    });

    // Parse output to get file stats
    const stdout = result.data?.stdout || '';
    const stderr = result.data?.stderr || '';

    // Count files from output
    const unchangedMatch = stdout.match(/(\d+) files? unchanged/);
    const changedMatch = stdout.match(/(\d+) files? formatted/);
    const checkedMatch = stdout.match(/(\d+) files? checked/);

    const unchangedCount = unchangedMatch ? parseInt(unchangedMatch[1] || '0', 10) : 0;
    const formattedCount = changedMatch ? parseInt(changedMatch[1] || '0', 10) : 0;
    const totalChecked = checkedMatch ? parseInt(checkedMatch[1] || '0', 10) : unchangedCount + formattedCount;

    const batchResult: BatchFormatResult = {
      files: [],
      totalFiles: totalChecked || (result.success ? 1 : 0),
      formattedCount,
      unchangedCount,
      errorCount: result.success ? 0 : 1,
      duration: Date.now() - startTime,
    };

    return {
      success: result.success,
      data: batchResult,
      metadata: {
        formatter: formatterType,
        stdout,
        stderr,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error formatting files',
      data: {
        files: [],
        totalFiles: 0,
        formattedCount: 0,
        unchangedCount: 0,
        errorCount: 1,
        duration: Date.now() - startTime,
      },
    };
  }
}

/**
 * Check if a file needs formatting
 */
export async function checkFormatting(
  filePath: string,
  options: Omit<FormatOptions, 'check' | 'write'> = {}
): Promise<ToolResult<{ needsFormat: boolean; filePath: string }>> {
  const result = await formatFile(filePath, { ...options, check: true, write: false });

  const checkResult: ToolResult<{ needsFormat: boolean; filePath: string }> = {
    success: true,
    data: {
      needsFormat: !result.success,
      filePath,
    },
  };
  if (result.metadata !== undefined) {
    checkResult.metadata = result.metadata;
  }
  return checkResult;
}
