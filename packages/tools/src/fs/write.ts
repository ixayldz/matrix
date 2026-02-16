import { writeFile, mkdir, unlink, rename, copyFile, stat } from 'fs/promises';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import type { ToolResult } from '@matrix/core';

/**
 * Write options
 */
export interface WriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  flag?: string;
  createDir?: boolean;
  backup?: boolean;
}

/**
 * Delete options
 */
export interface DeleteOptions {
  recursive?: boolean;
  force?: boolean;
}

/**
 * Write content to a file
 */
export async function fsWrite(
  filePath: string,
  content: string | Buffer,
  options: WriteOptions = {}
): Promise<ToolResult<{ path: string; bytesWritten: number; backup?: string }>> {
  const { encoding = 'utf-8', mode = 0o644, createDir = true, backup = false } = options;

  try {
    const resolved = resolve(filePath);
    const dir = dirname(resolved);

    // Create directory if needed
    if (createDir && !existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Create backup if requested and file exists
    let backupPath: string | undefined;
    if (backup && existsSync(resolved)) {
      backupPath = `${resolved}.backup-${Date.now()}`;
      await copyFile(resolved, backupPath);
    }

    // Write file
    await writeFile(resolved, content, { encoding, mode });

    const bytesWritten = typeof content === 'string' ? Buffer.byteLength(content, encoding) : content.length;

    return {
      success: true,
      data: {
        path: resolved,
        bytesWritten,
        ...(backupPath !== undefined ? { backup: backupPath } : {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error writing file',
    };
  }
}

/**
 * Create a directory
 */
export async function fsMkdir(
  dirPath: string,
  options: { recursive?: boolean; mode?: number } = {}
): Promise<ToolResult<{ path: string; created: boolean }>> {
  const { recursive = true, mode = 0o755 } = options;

  try {
    const resolved = resolve(dirPath);

    if (existsSync(resolved)) {
      return {
        success: true,
        data: { path: resolved, created: false },
      };
    }

    await mkdir(resolved, { recursive, mode });

    return {
      success: true,
      data: { path: resolved, created: true },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating directory',
    };
  }
}

/**
 * Delete a file
 */
export async function fsDelete(
  filePath: string,
  options: DeleteOptions = {}
): Promise<ToolResult<{ path: string; deleted: boolean }>> {
  const { force = false } = options;

  try {
    const resolved = resolve(filePath);

    if (!existsSync(resolved)) {
      if (force) {
        return { success: true, data: { path: resolved, deleted: false } };
      }
      return {
        success: false,
        error: `File does not exist: ${resolved}`,
      };
    }

    await unlink(resolved);

    return {
      success: true,
      data: { path: resolved, deleted: true },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error deleting file',
    };
  }
}

/**
 * Move/rename a file
 */
export async function fsMove(
  source: string,
  destination: string,
  options: { overwrite?: boolean; createDir?: boolean } = {}
): Promise<ToolResult<{ from: string; to: string }>> {
  const { overwrite = false, createDir = true } = options;

  try {
    const sourcePath = resolve(source);
    const destPath = resolve(destination);

    if (!existsSync(sourcePath)) {
      return {
        success: false,
        error: `Source file does not exist: ${sourcePath}`,
      };
    }

    if (existsSync(destPath) && !overwrite) {
      return {
        success: false,
        error: `Destination already exists: ${destPath}`,
      };
    }

    // Create destination directory if needed
    if (createDir) {
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
      }
    }

    await rename(sourcePath, destPath);

    return {
      success: true,
      data: { from: sourcePath, to: destPath },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error moving file',
    };
  }
}

/**
 * Copy a file
 */
export async function fsCopy(
  source: string,
  destination: string,
  options: { overwrite?: boolean; createDir?: boolean } = {}
): Promise<ToolResult<{ from: string; to: string; bytesCopied: number }>> {
  const { overwrite = false, createDir = true } = options;

  try {
    const sourcePath = resolve(source);
    const destPath = resolve(destination);

    if (!existsSync(sourcePath)) {
      return {
        success: false,
        error: `Source file does not exist: ${sourcePath}`,
      };
    }

    if (existsSync(destPath) && !overwrite) {
      return {
        success: false,
        error: `Destination already exists: ${destPath}`,
      };
    }

    // Create destination directory if needed
    if (createDir) {
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        await mkdir(destDir, { recursive: true });
      }
    }

    await copyFile(sourcePath, destPath);

    const stats = await stat(destPath);

    return {
      success: true,
      data: { from: sourcePath, to: destPath, bytesCopied: stats.size },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error copying file',
    };
  }
}

/**
 * Append content to a file
 */
export async function fsAppend(
  filePath: string,
  content: string | Buffer,
  options: { encoding?: BufferEncoding; createDir?: boolean } = {}
): Promise<ToolResult<{ path: string; bytesWritten: number }>> {
  const { encoding = 'utf-8', createDir = true } = options;

  try {
    const resolved = resolve(filePath);
    const dir = dirname(resolved);

    // Create directory if needed
    if (createDir && !existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Use append flag
    await writeFile(resolved, content, { encoding, flag: 'a' });

    const bytesWritten = typeof content === 'string' ? Buffer.byteLength(content, encoding) : content.length;

    return {
      success: true,
      data: { path: resolved, bytesWritten },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error appending to file',
    };
  }
}
