import { glob } from 'fast-glob';
import { readFile, stat } from 'fs/promises';
import { resolve, relative, extname, basename } from 'path';
import { existsSync } from 'fs';
import { getASTParser, type ASTSymbol } from '../ast/index.js';

/**
 * Discovery level - determines how much context to fetch
 */
export type DiscoveryLevel =
  | 'structure'    // Very low cost - file/folder tree only
  | 'definitions'  // Low cost - symbol list in file
  | 'interface'    // Medium cost - function signatures + docstrings
  | 'implementation'; // High cost - function bodies

/**
 * File structure node
 */
export interface FileNode {
  type: 'file' | 'directory';
  name: string;
  path: string;
  extension?: string;
  size?: number;
  children?: FileNode[];
}

/**
 * Symbol definition
 */
export interface SymbolDefinition {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'const' | 'import' | 'export' | 'method' | 'property';
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  signature?: string;
  docstring?: string;
  exported: boolean;
  async?: boolean;
  parent?: string;
  modifiers?: string[];
}

/**
 * Discovery options
 */
export interface DiscoveryOptions {
  cwd: string;
  ignore?: string[];
  maxDepth?: number;
  extensions?: string[];
}

/**
 * Default ignore patterns
 */
const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '*.min.js',
  '*.d.ts',
];

/**
 * Explore file structure (Level 1 - very low cost)
 */
export async function exploreStructure(
  options: DiscoveryOptions
): Promise<FileNode> {
  const { cwd, ignore = DEFAULT_IGNORE, maxDepth = 10, extensions } = options;

  async function buildTree(dir: string, depth: number): Promise<FileNode> {
    const name = basename(dir);
    const relativePath = relative(cwd, dir) || '.';

    if (depth > maxDepth) {
      return { type: 'directory', name, path: relativePath };
    }

    const children: FileNode[] = [];
    const entries = await glob('*', {
      cwd: dir,
      onlyFiles: false,
      ignore,
      dot: false,
      deep: 1,
    });

    for (const entry of entries) {
      const fullPath = resolve(dir, entry);
      const stats = await stat(fullPath);
      const entryRelativePath = relative(cwd, fullPath);

      if (stats.isDirectory()) {
        children.push(await buildTree(fullPath, depth + 1));
      } else {
        const ext = extname(entry);
        if (!extensions || extensions.includes(ext)) {
          children.push({
            type: 'file',
            name: entry,
            path: entryRelativePath,
            extension: ext,
            size: stats.size,
          });
        }
      }
    }

    return {
      type: 'directory',
      name,
      path: relativePath,
      children: children.sort((a, b) => {
        // Directories first, then files, alphabetically
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    };
  }

  return buildTree(cwd, 0);
}

/**
 * List definitions in a file (Level 2 - low cost)
 * Uses tree-sitter AST parsing with regex fallback
 */
export async function listDefinitions(
  filePath: string,
  options: DiscoveryOptions
): Promise<SymbolDefinition[]> {
  const { cwd } = options;
  const resolved = resolve(cwd, filePath);

  if (!existsSync(resolved)) {
    return [];
  }

  const content = await readFile(resolved, 'utf-8');
  const ext = extname(resolved);

  try {
    // Use AST parser for supported languages
    const parser = await getASTParser();
    const language = parser.detectLanguage(resolved);

    if (language) {
      const result = await parser.parse(content, language);

      // Convert AST symbols to SymbolDefinitions
      return result.symbols.map((s: ASTSymbol) => ({
        name: s.name,
        kind: s.kind,
        line: s.line,
        endLine: s.endLine,
        startColumn: s.startColumn,
        endColumn: s.endColumn,
        exported: s.exported,
        ...(s.signature !== undefined ? { signature: s.signature } : {}),
        ...(s.docstring !== undefined ? { docstring: s.docstring } : {}),
        ...(s.async !== undefined ? { async: s.async } : {}),
        ...(s.parent !== undefined ? { parent: s.parent } : {}),
        ...(s.modifiers !== undefined ? { modifiers: s.modifiers } : {}),
      }));
    }
  } catch (error) {
    // Fall back to regex parsing if AST fails
    console.debug(`AST parsing failed for ${filePath}, using regex fallback:`, error);
  }

  // Fallback to regex-based parsing for unsupported languages or errors
  const definitions: SymbolDefinition[] = [];
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    definitions.push(...parseTypeScriptDefinitions(content));
  } else if (ext === '.py') {
    definitions.push(...parsePythonDefinitions(content));
  }

  return definitions;
}

/**
 * Read interface signatures (Level 3 - medium cost)
 */
export async function readInterface(
  filePath: string,
  symbolName: string,
  options: DiscoveryOptions
): Promise<{ signature: string; docstring?: string } | null> {
  const { cwd } = options;
  const resolved = resolve(cwd, filePath);

  if (!existsSync(resolved)) {
    return null;
  }

  const content = await readFile(resolved, 'utf-8');
  const lines = content.split('\n');

  // Find the symbol
  const definitions = await listDefinitions(filePath, options);
  const symbol = definitions.find(d => d.name === symbolName);

  if (!symbol) {
    return null;
  }

  // Extract signature and docstring
  const startLine = symbol.line - 1;
  let endLine = symbol.endLine ?? startLine + 10;
  endLine = Math.min(endLine, lines.length);

  // Look for docstring before the symbol
  let docstring: string | undefined;
  let docstringStart = startLine - 1;

  while (docstringStart >= 0) {
    const line = lines[docstringStart]?.trim();
    if (line?.startsWith('/**') || line?.startsWith('*') || line?.startsWith('*/')) {
      docstringStart--;
    } else if (line?.startsWith('#')) {
      // Python-style docstring
      docstring = line.slice(1).trim();
      break;
    } else {
      break;
    }
  }

  if (!docstring && docstringStart < startLine - 1) {
    // Extract JSDoc
    const docLines = lines.slice(docstringStart + 1, startLine);
    docstring = docLines
      .map(l => l.trim().replace(/^\* ?/, ''))
      .filter(l => l && !l.startsWith('/'))
      .join('\n');
  }

  const signature = lines.slice(startLine, endLine).join('\n');
  return docstring ? { signature, docstring } : { signature };
}

/**
 * Read implementation (Level 4 - high cost)
 */
export async function readImplementation(
  filePath: string,
  symbolName: string,
  options: DiscoveryOptions
): Promise<string | null> {
  const { cwd } = options;
  const resolved = resolve(cwd, filePath);

  if (!existsSync(resolved)) {
    return null;
  }

  const content = await readFile(resolved, 'utf-8');
  const lines = content.split('\n');

  const definitions = await listDefinitions(filePath, options);
  const symbol = definitions.find(d => d.name === symbolName);

  if (!symbol) {
    return null;
  }

  const startLine = symbol.line - 1;
  let endLine = symbol.endLine ?? findEndOfBlock(lines, startLine);

  return lines.slice(startLine, endLine).join('\n');
}

/**
 * Parse TypeScript/JavaScript definitions
 */
function parseTypeScriptDefinitions(content: string): SymbolDefinition[] {
  const definitions: SymbolDefinition[] = [];

  // Function declarations
  const funcRegex = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'function',
      line,
      exported: match[0].includes('export'),
      signature: extractSignature(content, match.index),
    });
  }

  // Arrow functions as const
  const arrowRegex = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])*=>/gm;
  while ((match = arrowRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'function',
      line,
      exported: match[0].includes('export'),
      signature: extractSignature(content, match.index),
    });
  }

  // Class declarations
  const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'class',
      line,
      exported: match[0].includes('export'),
    });
  }

  // Interface declarations
  const interfaceRegex = /^(?:export\s+)?interface\s+(\w+)/gm;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'interface',
      line,
      exported: match[0].includes('export'),
    });
  }

  // Type declarations
  const typeRegex = /^(?:export\s+)?type\s+(\w+)/gm;
  while ((match = typeRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'type',
      line,
      exported: match[0].includes('export'),
    });
  }

  return definitions.sort((a, b) => a.line - b.line);
}

/**
 * Parse Python definitions
 */
function parsePythonDefinitions(content: string): SymbolDefinition[] {
  const definitions: SymbolDefinition[] = [];

  // Function definitions
  const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/gm;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'function',
      line,
      exported: !match[0].startsWith('_'),
    });
  }

  // Class definitions
  const classRegex = /^class\s+(\w+)/gm;
  while ((match = classRegex.exec(content)) !== null) {
    const line = content.substring(0, match.index).split('\n').length;
    definitions.push({
      name: match[1]!,
      kind: 'class',
      line,
      exported: !match[0].startsWith('_'),
    });
  }

  return definitions.sort((a, b) => a.line - b.line);
}

/**
 * Extract function signature from content
 */
function extractSignature(content: string, startIndex: number): string {
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let signature = '';

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i]!;

    if (inString) {
      signature += char;
      if (char === stringChar && content[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      signature += char;
      continue;
    }

    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        signature += char;
        break;
      }
    }

    signature += char;

    // Stop at first statement for arrow functions
    if (braceCount === 0 && char === ';' && signature.includes('=>')) {
      break;
    }
  }

  return signature.trim();
}

/**
 * Find end of code block
 */
function findEndOfBlock(lines: string[], startLine: number): number {
  let braceCount = 0;
  let foundOpenBrace = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;

    for (const char of line) {
      if (char === '{') {
        braceCount++;
        foundOpenBrace = true;
      } else if (char === '}') {
        braceCount--;
        if (foundOpenBrace && braceCount === 0) {
          return i + 1;
        }
      }
    }
  }

  return lines.length;
}
