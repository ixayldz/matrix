import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git';
import type { ToolResult } from '@matrix/core';

/**
 * Git status information
 */
export interface GitStatus {
  isRepo: boolean;
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  created: string[];
  deleted: string[];
  conflicted: string[];
  untracked: string[];
  clean: boolean;
}

/**
 * Git log entry
 */
export interface GitLogEntry {
  hash: string;
  hashShort: string;
  message: string;
  author: string;
  email: string;
  date: string;
  refs: string[];
}

/**
 * Git diff result
 */
export interface GitDiffResult {
  files: Array<{
    file: string;
    changes: number;
    insertions: number;
    deletions: number;
    binary: boolean;
  }>;
  insertions: number;
  deletions: number;
  filesChanged: number;
}

/**
 * Git branch info
 */
export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
}

/**
 * Create a simple-git instance
 */
function getGit(workingDir: string): SimpleGit {
  return simpleGit(workingDir);
}

/**
 * Check if directory is a git repository
 */
export async function gitIsRepo(workingDir: string): Promise<ToolResult<boolean>> {
  try {
    const git = getGit(workingDir);
    const isRepo = await git.checkIsRepo();
    return { success: true, data: isRepo };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error checking git repo',
    };
  }
}

/**
 * Get git status
 */
export async function gitStatus(workingDir: string): Promise<ToolResult<GitStatus>> {
  try {
    const git = getGit(workingDir);
    const status: StatusResult = await git.status();

    return {
      success: true,
      data: {
        isRepo: true,
        branch: status.current ?? '',
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        conflicted: status.conflicted,
        untracked: status.not_added,
        clean: status.isClean(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting git status',
    };
  }
}

/**
 * Get git diff
 */
export async function gitDiff(
  workingDir: string,
  options: { staged?: boolean; file?: string } = {}
): Promise<ToolResult<string>> {
  try {
    const git = getGit(workingDir);
    let diff: string;

    if (options.staged) {
      const diffArgs: string[] = ['--cached'];
      if (options.file) {
        diffArgs.push(options.file);
      }
      diff = await git.diff(diffArgs);
    } else if (options.file) {
      diff = await git.diff([options.file]);
    } else {
      diff = await git.diff();
    }

    return { success: true, data: diff };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting git diff',
    };
  }
}

/**
 * Get git diff summary
 */
export async function gitDiffSummary(
  workingDir: string,
  options: { staged?: boolean } = {}
): Promise<ToolResult<GitDiffResult>> {
  try {
    const git = getGit(workingDir);
    const args = options.staged ? ['--cached', '--stat'] : ['--stat'];
    const summary = await git.diffSummary(args);

    return {
      success: true,
      data: {
        files: summary.files.map((f) => ({
          file: f.file,
          changes: 'changes' in f && typeof f.changes === 'number' ? f.changes : 0,
          insertions: 'insertions' in f && typeof f.insertions === 'number' ? f.insertions : 0,
          deletions: 'deletions' in f && typeof f.deletions === 'number' ? f.deletions : 0,
          binary: 'binary' in f && typeof f.binary === 'boolean' ? f.binary : false,
        })),
        insertions: summary.insertions ?? 0,
        deletions: summary.deletions ?? 0,
        filesChanged: summary.files.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting git diff summary',
    };
  }
}

/**
 * Stage files
 */
export async function gitAdd(
  workingDir: string,
  files: string | string[]
): Promise<ToolResult<{ staged: string[] }>> {
  try {
    const git = getGit(workingDir);
    const fileList = Array.isArray(files) ? files : [files];
    await git.add(fileList);

    return {
      success: true,
      data: { staged: fileList },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error staging files',
    };
  }
}

/**
 * Commit changes
 */
export async function gitCommit(
  workingDir: string,
  message: string,
  options: { amend?: boolean; noVerify?: boolean } = {}
): Promise<ToolResult<{ hash: string; branch: string }>> {
  try {
    const git = getGit(workingDir);
    const commitArgs = ['commit', '-m', message];
    if (options.amend) {
      commitArgs.push('--amend');
    }
    if (options.noVerify) {
      commitArgs.push('--no-verify');
    }
    await git.raw(commitArgs);
    const hash = (await git.revparse(['HEAD'])).trim();
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

    return {
      success: true,
      data: {
        hash,
        branch,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error committing changes',
    };
  }
}

/**
 * Get commit log
 */
export async function gitLog(
  workingDir: string,
  options: { maxCount?: number; file?: string } = {}
): Promise<ToolResult<GitLogEntry[]>> {
  try {
    const git = getGit(workingDir);
    const logArgs: string[] = [`--max-count=${options.maxCount ?? 50}`];
    if (options.file) {
      logArgs.push('--', options.file);
    }
    const log = await git.log(logArgs);

    const entries: GitLogEntry[] = log.all.map((entry) => ({
      hash: entry.hash,
      hashShort: entry.hash.slice(0, 7),
      message: entry.message,
      author: entry.author_name,
      email: entry.author_email,
      date: entry.date,
      refs: entry.refs
        ? entry.refs.split(',').map((ref) => ref.trim()).filter((ref) => ref.length > 0)
        : [],
    }));

    return { success: true, data: entries };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting git log',
    };
  }
}

/**
 * Get branches
 */
export async function gitBranchList(workingDir: string): Promise<ToolResult<GitBranch[]>> {
  try {
    const git = getGit(workingDir);
    const branches = await git.branchLocal();

    const result: GitBranch[] = branches.all.map((name) => ({
      name,
      current: name === branches.current,
      remote: false,
    }));

    // Add remote branches
    const remoteBranches = await git.branch(['-r']);
    for (const name of remoteBranches.all) {
      result.push({
        name,
        current: false,
        remote: true,
      });
    }

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error listing branches',
    };
  }
}

/**
 * Create a new branch
 */
export async function gitBranchCreate(
  workingDir: string,
  branchName: string,
  options: { checkout?: boolean } = {}
): Promise<ToolResult<{ name: string; created: boolean }>> {
  try {
    const git = getGit(workingDir);

    if (options.checkout) {
      await git.checkoutLocalBranch(branchName);
    } else {
      await git.branch([branchName]);
    }

    return {
      success: true,
      data: { name: branchName, created: true },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating branch',
    };
  }
}

/**
 * Checkout a branch
 */
export async function gitCheckout(
  workingDir: string,
  branchName: string,
  options: { create?: boolean } = {}
): Promise<ToolResult<{ branch: string }>> {
  try {
    const git = getGit(workingDir);

    if (options.create) {
      await git.checkoutLocalBranch(branchName);
    } else {
      await git.checkout(branchName);
    }

    return { success: true, data: { branch: branchName } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error checking out branch',
    };
  }
}

/**
 * Get current branch name
 */
export async function gitCurrentBranch(workingDir: string): Promise<ToolResult<string>> {
  try {
    const git = getGit(workingDir);
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return { success: true, data: branch.trim() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting current branch',
    };
  }
}
