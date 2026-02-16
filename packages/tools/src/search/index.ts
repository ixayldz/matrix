import { glob } from 'fast-glob';
import { readFile } from 'fs/promises';
import { resolve, relative } from 'path';
import type { ToolResult } from '@matrix/core';

/**
 * Search options
 */
export interface SearchOptions {
  cwd?: string;
  ignore?: string[];
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  multiline?: boolean;
  maxResults?: number;
  contextLines?: number;
}

/**
 * Search match
 */
export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  lineContent: string;
  match: string;
  context?: {
    before: string[];
    after: string[];
  };
}

/**
 * Search result
 */
export interface SearchResult {
  matches: SearchMatch[];
  filesSearched: number;
  filesWithMatches: number;
  totalMatches: number;
}

/**
 * Glob options
 */
export interface GlobOptions {
  cwd?: string;
  ignore?: string[];
  absolute?: boolean;
  dot?: boolean;
  deep?: number;
  onlyFiles?: boolean;
  onlyDirectories?: boolean;
}

/**
 * Search for a pattern in files
 */
export async function search(
  pattern: string,
  options: SearchOptions = {}
): Promise<ToolResult<SearchResult>> {
  const {
    cwd = process.cwd(),
    ignore = ['node_modules', '.git', 'dist', 'build'],
    caseSensitive = false,
    wholeWord = false,
    regex = false,
    maxResults = 1000,
    contextLines = 0,
  } = options;

  try {
    // Get all text files
    const files = await glob('**/*', {
      cwd,
      ignore,
      absolute: true,
      onlyFiles: true,
      dot: false,
    });

    // Build regex pattern
    let searchPattern: RegExp;
    if (regex) {
      const flags = caseSensitive ? 'g' : 'gi';
      searchPattern = new RegExp(pattern, flags);
    } else {
      let escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        escapedPattern = `\\b${escapedPattern}\\b`;
      }
      const flags = caseSensitive ? 'g' : 'gi';
      searchPattern = new RegExp(escapedPattern, flags);
    }

    const matches: SearchMatch[] = [];
    let filesWithMatches = 0;

    for (const file of files) {
      if (matches.length >= maxResults) break;

      try {
        const content = await readFile(file, 'utf-8');
        const lines = content.split('\n');
        let fileHasMatch = false;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          if (matches.length >= maxResults) break;

          const line = lines[lineNum] ?? '';
          const lineMatches = line.matchAll(searchPattern);

          for (const match of lineMatches) {
            if (matches.length >= maxResults) break;

            fileHasMatch = true;

            const searchMatch: SearchMatch = {
              file: relative(cwd, file),
              line: lineNum + 1,
              column: (match.index ?? 0) + 1,
              lineContent: line,
              match: match[0],
            };

            // Add context lines if requested
            if (contextLines > 0) {
              searchMatch.context = {
                before: lines.slice(Math.max(0, lineNum - contextLines), lineNum),
                after: lines.slice(lineNum + 1, lineNum + 1 + contextLines),
              };
            }

            matches.push(searchMatch);
          }
        }

        if (fileHasMatch) {
          filesWithMatches++;
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return {
      success: true,
      data: {
        matches,
        filesSearched: files.length,
        filesWithMatches,
        totalMatches: matches.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during search',
    };
  }
}

/**
 * Search in a specific file
 */
export async function searchInFile(
  filePath: string,
  pattern: string,
  options: Omit<SearchOptions, 'cwd'> = {}
): Promise<ToolResult<SearchMatch[]>> {
  const { caseSensitive = false, wholeWord = false, regex = false, contextLines = 0 } = options;

  try {
    const resolved = resolve(filePath);
    const content = await readFile(resolved, 'utf-8');
    const lines = content.split('\n');

    // Build regex pattern
    let searchPattern: RegExp;
    if (regex) {
      const flags = caseSensitive ? 'g' : 'gi';
      searchPattern = new RegExp(pattern, flags);
    } else {
      let escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) {
        escapedPattern = `\\b${escapedPattern}\\b`;
      }
      const flags = caseSensitive ? 'g' : 'gi';
      searchPattern = new RegExp(escapedPattern, flags);
    }

    const matches: SearchMatch[] = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum] ?? '';
      const lineMatches = line.matchAll(searchPattern);

      for (const match of lineMatches) {
        const searchMatch: SearchMatch = {
          file: filePath,
          line: lineNum + 1,
          column: (match.index ?? 0) + 1,
          lineContent: line,
          match: match[0],
        };

        if (contextLines > 0) {
          searchMatch.context = {
            before: lines.slice(Math.max(0, lineNum - contextLines), lineNum),
            after: lines.slice(lineNum + 1, lineNum + 1 + contextLines),
          };
        }

        matches.push(searchMatch);
      }
    }

    return { success: true, data: matches };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error searching file',
    };
  }
}

/**
 * Find files by glob pattern
 */
export async function findFiles(
  pattern: string | string[],
  options: GlobOptions = {}
): Promise<ToolResult<string[]>> {
  const {
    cwd = process.cwd(),
    ignore = ['node_modules', '.git'],
    absolute = false,
    dot = false,
    onlyFiles = true,
  } = options;

  try {
    const files = await glob(pattern, {
      cwd,
      ignore,
      absolute,
      dot,
      onlyFiles,
      onlyDirectories: !onlyFiles,
    });

    return {
      success: true,
      data: files,
      metadata: { count: files.length },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error finding files',
    };
  }
}

/**
 * Find files by name pattern
 */
export async function findByName(
  namePattern: string,
  options: GlobOptions = {}
): Promise<ToolResult<string[]>> {
  const pattern = `**/*${namePattern}*`;
  return findFiles(pattern, options);
}

/**
 * Find files by extension
 */
export async function findByExtension(
  extension: string,
  options: GlobOptions = {}
): Promise<ToolResult<string[]>> {
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const pattern = `**/*${ext}`;
  return findFiles(pattern, options);
}
