import { readFile, stat, readdir, access } from 'fs/promises';
import { join, resolve, relative, extname, basename } from 'path';
import { constants } from 'fs';
import type { ToolResult } from '@matrix/core';

/**
 * File read options
 */
export interface ReadOptions {
  encoding?: BufferEncoding;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
}

/**
 * File info
 */
export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  created: Date;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

/**
 * Directory listing options
 */
export interface ListOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
  filter?: (name: string, isDirectory: boolean) => boolean;
}

/**
 * Directory entry
 */
export interface DirEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  extension?: string;
  size?: number;
}

/**
 * Read a file's contents
 */
export async function fsRead(
  filePath: string,
  options: ReadOptions = {}
): Promise<ToolResult<string>> {
  const { encoding = 'utf-8', startLine, endLine, maxBytes = 1024 * 1024 } = options;

  try {
    const resolved = resolve(filePath);

    // Check file exists
    await access(resolved, constants.R_OK);

    // Check file size
    const stats = await stat(resolved);
    if (stats.size > maxBytes) {
      return {
        success: false,
        error: `File too large: ${stats.size} bytes (max: ${maxBytes})`,
      };
    }

    // Read file
    const content = await readFile(resolved, encoding);

    // Apply line limits if specified
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
      return {
        success: true,
        data: lines.slice(start, end).join('\n'),
        metadata: { totalLines: lines.length, returnedLines: end - start },
      };
    }

    return {
      success: true,
      data: content,
      metadata: { size: stats.size, lines: content.split('\n').length },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error reading file',
    };
  }
}

/**
 * Get file information
 */
export async function fsStat(filePath: string): Promise<ToolResult<FileInfo>> {
  try {
    const resolved = resolve(filePath);
    const stats = await stat(resolved);

    return {
      success: true,
      data: {
        path: resolved,
        name: basename(resolved),
        extension: extname(resolved),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting file info',
    };
  }
}

/**
 * List directory contents
 */
export async function fsList(
  dirPath: string,
  options: ListOptions = {}
): Promise<ToolResult<DirEntry[]>> {
  const { recursive = false, includeHidden = false, maxDepth = 10, filter } = options;

  try {
    const resolved = resolve(dirPath);
    const entries: DirEntry[] = [];

    async function scanDir(path: string, depth: number): Promise<void> {
      if (depth > maxDepth) return;

      const files = await readdir(path, { withFileTypes: true });

      for (const file of files) {
        // Skip hidden files unless included
        if (!includeHidden && file.name.startsWith('.')) {
          continue;
        }

        const fullPath = join(path, file.name);
        const isDir = file.isDirectory();

        // Apply filter
        if (filter && !filter(file.name, isDir)) {
          continue;
        }

        const entry: DirEntry = {
          path: fullPath,
          name: file.name,
          isDirectory: isDir,
          isFile: file.isFile(),
          ...(!isDir ? { extension: extname(file.name) } : {}),
        };

        // Get size for files
        if (file.isFile()) {
          try {
            const stats = await stat(fullPath);
            entry.size = stats.size;
          } catch {
            // Ignore stat errors
          }
        }

        entries.push(entry);

        // Recurse into directories
        if (recursive && isDir) {
          await scanDir(fullPath, depth + 1);
        }
      }
    }

    await scanDir(resolved, 0);

    return {
      success: true,
      data: entries,
      metadata: { count: entries.length },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error listing directory',
    };
  }
}

/**
 * Check if a file exists
 */
export async function fsExists(filePath: string): Promise<ToolResult<boolean>> {
  try {
    const resolved = resolve(filePath);
    await access(resolved, constants.F_OK);
    return { success: true, data: true };
  } catch {
    return { success: true, data: false };
  }
}

/**
 * Check if a path is readable
 */
export async function fsIsReadable(filePath: string): Promise<ToolResult<boolean>> {
  try {
    const resolved = resolve(filePath);
    await access(resolved, constants.R_OK);
    return { success: true, data: true };
  } catch {
    return { success: true, data: false };
  }
}

/**
 * Check if a path is writable
 */
export async function fsIsWritable(filePath: string): Promise<ToolResult<boolean>> {
  try {
    const resolved = resolve(filePath);
    await access(resolved, constants.W_OK);
    return { success: true, data: true };
  } catch {
    return { success: true, data: false };
  }
}

/**
 * Get relative path from one file to another
 */
export function fsRelative(from: string, to: string): string {
  return relative(resolve(from), resolve(to));
}

/**
 * Resolve a path to absolute
 */
export function fsResolve(...pathSegments: string[]): string {
  return resolve(...pathSegments);
}
