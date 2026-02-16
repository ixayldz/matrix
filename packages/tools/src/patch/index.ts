import * as diff from 'diff';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import type { ToolResult, DiffHunk } from '@matrix/core';

/**
 * Unified diff result
 */
export interface DiffResult {
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  patch: string;
}

/**
 * Patch apply result
 */
export interface PatchResult {
  filePath: string;
  hunksApplied: number;
  hunksFailed: number;
  backupPath?: string;
}

/**
 * Create a unified diff between two strings
 */
export function createDiff(
  oldContent: string,
  newContent: string,
  filePath: string = 'file'
): DiffResult {
  const patch = diff.createPatch(filePath, oldContent, newContent);
  const parsed = diff.parsePatch(patch);

  let additions = 0;
  let deletions = 0;
  const hunks: DiffHunk[] = [];

  for (const hunk of parsed[0]?.hunks ?? []) {
    hunks.push({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      content: hunk.lines.join('\n'),
    });

    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
  }

  return { hunks, additions, deletions, patch };
}

/**
 * Apply a patch to content
 */
export function applyPatch(content: string, patch: string): { success: boolean; result: string } {
  const result = diff.applyPatch(content, patch);

  if (result === false) {
    return { success: false, result: content };
  }

  return { success: true, result };
}

/**
 * Apply a patch to a file
 */
export async function applyPatchToFile(
  filePath: string,
  patch: string,
  options: { backup?: boolean } = {}
): Promise<ToolResult<PatchResult>> {
  try {
    const resolved = resolve(filePath);

    if (!existsSync(resolved)) {
      return {
        success: false,
        error: `File does not exist: ${resolved}`,
      };
    }

    const oldContent = await readFile(resolved, 'utf-8');
    const result = applyPatch(oldContent, patch);

    if (!result.success) {
      return {
        success: false,
        error: 'Failed to apply patch',
        data: {
          filePath: resolved,
          hunksApplied: 0,
          hunksFailed: 1,
        },
      };
    }

    // Create backup if requested
    let backupPath: string | undefined;
    if (options.backup) {
      backupPath = `${resolved}.backup-${Date.now()}`;
      await writeFile(backupPath, oldContent);
    }

    await writeFile(resolved, result.result);

    // Count hunks
    const parsed = diff.parsePatch(patch);
    const hunksApplied = parsed[0]?.hunks.length ?? 0;

    return {
      success: true,
      data: {
        filePath: resolved,
        hunksApplied,
        hunksFailed: 0,
        ...(backupPath !== undefined ? { backupPath } : {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error applying patch',
    };
  }
}

/**
 * Create a diff between two files
 */
export async function diffFiles(
  oldFile: string,
  newFile: string
): Promise<ToolResult<DiffResult>> {
  try {
    const oldPath = resolve(oldFile);
    const newPath = resolve(newFile);

    const oldContent = existsSync(oldPath) ? await readFile(oldPath, 'utf-8') : '';
    const newContent = existsSync(newPath) ? await readFile(newPath, 'utf-8') : '';

    const result = createDiff(oldContent, newContent, oldFile);

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating diff',
    };
  }
}

/**
 * Reverse a patch
 */
export function reversePatch(patch: string): string {
  const parsed = diff.parsePatch(patch);

  for (const file of parsed) {
    for (const hunk of file.hunks) {
      // Swap old and new positions
      const tempStart = hunk.oldStart;
      const tempLines = hunk.oldLines;
      hunk.oldStart = hunk.newStart;
      hunk.oldLines = hunk.newLines;
      hunk.newStart = tempStart;
      hunk.newLines = tempLines;

      // Reverse line changes
      hunk.lines = hunk.lines.map((line) => {
        if (line.startsWith('+')) {
          return '-' + line.slice(1);
        }
        if (line.startsWith('-')) {
          return '+' + line.slice(1);
        }
        return line;
      });
    }
  }

  // Reconstruct patch
  return parsed.map((file) => {
    const header = `--- ${file.oldFileName}\n+++ ${file.newFileName}\n`;
    const hunks = file.hunks
      .map(
        (hunk) =>
          `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`
      )
      .join('\n');
    return header + hunks;
  }).join('\n');
}

/**
 * Rollback a patch (apply reverse)
 */
export async function rollbackPatch(
  filePath: string,
  patch: string,
  options: { backup?: boolean } = {}
): Promise<ToolResult<PatchResult>> {
  const reversedPatch = reversePatch(patch);
  return applyPatchToFile(filePath, reversedPatch, options);
}

/**
 * Get hunk-level diffs
 */
export function getHunks(patch: string): DiffHunk[] {
  const parsed = diff.parsePatch(patch);

  const hunks: DiffHunk[] = [];

  for (const file of parsed) {
    for (const hunk of file.hunks) {
      hunks.push({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        content: hunk.lines.join('\n'),
      });
    }
  }

  return hunks;
}

/**
 * Apply specific hunk from a patch
 */
export function applyHunk(content: string, hunk: DiffHunk): string {
  const lines = content.split('\n');

  // Remove old lines
  const beforeHunk = lines.slice(0, hunk.oldStart - 1);
  const afterHunk = lines.slice(hunk.oldStart - 1 + hunk.oldLines);

  // Parse new lines from hunk content
  const hunkLines = hunk.content.split('\n');
  const newLines = hunkLines
    .filter((line) => !line.startsWith('-'))
    .map((line) => (line.startsWith('+') ? line.slice(1) : line));

  return [...beforeHunk, ...newLines, ...afterHunk].join('\n');
}
