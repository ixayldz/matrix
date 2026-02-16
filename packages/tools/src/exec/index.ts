import { execa, type ExecaError, type ExecaReturnValue } from 'execa';
import type { ToolResult } from '@matrix/core';

/**
 * Exec options
 */
export interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  shell?: boolean | string;
  input?: string;
  reject?: boolean;
  extendEnv?: boolean;
}

/**
 * Exec result
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
  timedOut: boolean;
  command: string;
  duration: number;
}

/**
 * Execute a command
 */
export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ToolResult<ExecResult>> {
  const {
    cwd = process.cwd(),
    timeout = 60000,
    env = {},
    shell = false,
    input,
    reject = false,
    extendEnv = true,
  } = options;

  const startTime = Date.now();

  try {
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );
    const mergedEnv = extendEnv ? { ...baseEnv, ...env } : env;
    const execaOptions = {
      cwd,
      timeout,
      env: mergedEnv,
      shell,
      reject,
      ...(input !== undefined ? { input } : {}),
    };

    const result: ExecaReturnValue = await execa(command, args, execaOptions);

    return {
      success: true,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
        failed: result.failed,
        timedOut: result.timedOut,
        command: result.command,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    const execaError = error as ExecaError;

    return {
      success: false,
      error: execaError.message,
      data: {
        stdout: execaError.stdout ?? '',
        stderr: execaError.stderr ?? '',
        exitCode: execaError.exitCode ?? 1,
        failed: true,
        timedOut: execaError.timedOut ?? false,
        command: execaError.command ?? `${command} ${args.join(' ')}`,
        duration: Date.now() - startTime,
      },
    };
  }
}

/**
 * Execute a command with shell
 */
export async function execShell(
  command: string,
  options: ExecOptions = {}
): Promise<ToolResult<ExecResult>> {
  return exec(command, [], { ...options, shell: true });
}

/**
 * Execute a command and stream output
 */
export async function* execStream(
  command: string,
  args: string[] = [],
  options: ExecOptions = {}
): AsyncGenerator<{ type: 'stdout' | 'stderr'; data: string }> {
  const { cwd = process.cwd(), timeout = 60000, env = {}, extendEnv = true } = options;
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const mergedEnv = extendEnv ? { ...baseEnv, ...env } : env;

  const subprocess = execa(command, args, {
    cwd,
    timeout,
    env: mergedEnv,
    reject: false,
  });

  // Stream stdout
  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      yield { type: 'stdout', data: chunk.toString() };
    }
  }

  // Stream stderr
  if (subprocess.stderr) {
    for await (const chunk of subprocess.stderr) {
      yield { type: 'stderr', data: chunk.toString() };
    }
  }

  await subprocess;
}

/**
 * Execute with timeout wrapper
 */
export async function execWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  options: ExecOptions = {}
): Promise<ToolResult<ExecResult>> {
  return exec(command, args, { ...options, timeout: timeoutMs });
}

/**
 * Check if a command exists
 */
export async function execExists(command: string): Promise<boolean> {
  try {
    const result = await exec('which', [command], { shell: true });
    return result.success && result.data?.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get command version
 */
export async function execVersion(command: string): Promise<ToolResult<string>> {
  try {
    const result = await exec(command, ['--version'], { reject: false });
    if (result.success && result.data) {
      return { success: true, data: result.data.stdout.trim() };
    }
    return { success: false, error: 'Command not found or no version flag' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting version',
    };
  }
}
