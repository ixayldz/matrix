import type { FileNode, SymbolDefinition, DiscoveryLevel } from '../discovery/index.js';

/**
 * Focus area for pruning
 */
export interface FocusArea {
  paths: string[];
  symbols?: string[];
  keywords?: string[];
}

/**
 * Pruning result
 */
export interface PruningResult {
  included: string[];
  excluded: string[];
  reason: Map<string, string>;
}

/**
 * Semantic context for pruning decisions
 */
export interface SemanticContext {
  focusArea: FocusArea;
  maxTokens: number;
  currentTokens: number;
  priorityFiles: string[];
}

/**
 * Prune file tree based on focus area
 */
export function pruneStructure(
  root: FileNode,
  context: SemanticContext
): PruningResult {
  const included: string[] = [];
  const excluded: string[] = [];
  const reason = new Map<string, string>();

  function visit(node: FileNode): void {
    const isInFocus = isInFocusArea(node.path, context.focusArea);
    const isPriority = context.priorityFiles.some(f =>
      node.path === f || node.path.startsWith(f + '/')
    );

    if (node.type === 'file') {
      if (isInFocus || isPriority) {
        included.push(node.path);
        reason.set(node.path, isInFocus ? 'In focus area' : 'Priority file');
      } else {
        excluded.push(node.path);
        reason.set(node.path, 'Outside focus area');
      }
    }

    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(root);

  return { included, excluded, reason };
}

/**
 * Prune definitions based on relevance
 */
export function pruneDefinitions(
  definitions: SymbolDefinition[],
  context: SemanticContext
): SymbolDefinition[] {
  const { focusArea, maxTokens, currentTokens } = context;

  let tokenCount = currentTokens;
  const result: SymbolDefinition[] = [];

  // Sort by relevance
  const sorted = [...definitions].sort((a, b) => {
    // Exported symbols are more relevant
    if (a.exported !== b.exported) return a.exported ? -1 : 1;

    // Symbols matching focus keywords
    const aMatches = focusArea.keywords?.some(k =>
      a.name.toLowerCase().includes(k.toLowerCase())
    ) ?? false;
    const bMatches = focusArea.keywords?.some(k =>
      b.name.toLowerCase().includes(k.toLowerCase())
    ) ?? false;
    if (aMatches !== bMatches) return aMatches ? -1 : 1;

    return 0;
  });

  for (const def of sorted) {
    const estimatedTokens = estimateSymbolTokens(def);

    if (tokenCount + estimatedTokens <= maxTokens) {
      result.push(def);
      tokenCount += estimatedTokens;
    }
  }

  return result;
}

/**
 * Determine optimal discovery level based on context
 */
export function determineDiscoveryLevel(
  filePath: string,
  context: SemanticContext
): DiscoveryLevel {
  const { focusArea, priorityFiles, maxTokens, currentTokens } = context;

  // Priority files get full implementation
  if (priorityFiles.includes(filePath)) {
    return 'implementation';
  }

  // Files in focus area get interface level
  if (isInFocusArea(filePath, focusArea)) {
    const tokenBudget = maxTokens - currentTokens;

    if (tokenBudget > 10000) {
      return 'implementation';
    } else if (tokenBudget > 5000) {
      return 'interface';
    } else {
      return 'definitions';
    }
  }

  // Other files get structure only
  return 'structure';
}

/**
 * Calculate relevance score for a file
 */
export function calculateRelevance(
  filePath: string,
  context: SemanticContext
): number {
  const { focusArea, priorityFiles } = context;

  let score = 0;

  // Priority files get highest score
  if (priorityFiles.includes(filePath)) {
    score += 100;
  }

  // Path matches focus area
  if (isInFocusArea(filePath, focusArea)) {
    score += 50;
  }

  // Keywords match
  if (focusArea.keywords) {
    const fileName = filePath.split('/').pop() ?? '';
    for (const keyword of focusArea.keywords) {
      if (fileName.toLowerCase().includes(keyword.toLowerCase())) {
        score += 20;
      }
    }
  }

  // Prefer closer to focus paths
  for (const focusPath of focusArea.paths) {
    const distance = calculatePathDistance(filePath, focusPath);
    score += Math.max(0, 20 - distance * 5);
  }

  return score;
}

/**
 * Check if path is in focus area
 */
function isInFocusArea(path: string, focusArea: FocusArea): boolean {
  // Check if path matches any focus path
  for (const focusPath of focusArea.paths) {
    if (path === focusPath || path.startsWith(focusPath + '/')) {
      return true;
    }
  }

  // Check symbols
  if (focusArea.symbols) {
    const fileName = path.split('/').pop() ?? '';
    for (const symbol of focusArea.symbols) {
      if (fileName.includes(symbol)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculate distance between two paths
 */
function calculatePathDistance(path1: string, path2: string): number {
  const parts1 = path1.split('/');
  const parts2 = path2.split('/');

  // Find common prefix length
  let commonLength = 0;
  for (let i = 0; i < Math.min(parts1.length, parts2.length); i++) {
    if (parts1[i] === parts2[i]) {
      commonLength++;
    } else {
      break;
    }
  }

  // Distance is sum of remaining parts
  return (parts1.length - commonLength) + (parts2.length - commonLength);
}

/**
 * Estimate token count for a symbol
 */
function estimateSymbolTokens(def: SymbolDefinition): number {
  let tokens = 20; // Base tokens for name and kind

  if (def.signature) {
    tokens += Math.ceil(def.signature.length / 4);
  }

  if (def.docstring) {
    tokens += Math.ceil(def.docstring.length / 4);
  }

  return tokens;
}

/**
 * Build semantic context from user query
 */
export function buildSemanticContext(
  query: string,
  options: {
    maxTokens?: number;
    priorityFiles?: string[];
  } = {}
): SemanticContext {
  const { maxTokens = 50000, priorityFiles = [] } = options;

  // Extract potential paths from query
  const pathMatches = query.match(/(?:src\/|packages\/|lib\/)?[\w/]+(?:\.\w+)?/g) ?? [];

  // Extract potential symbols from query
  const symbolMatches = query.match(/\b[A-Z][a-zA-Z]+\b/g) ?? [];

  // Extract keywords
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !['the', 'and', 'for', 'this', 'that', 'with'].includes(w));

  return {
    focusArea: {
      paths: pathMatches,
      symbols: symbolMatches,
      keywords,
    },
    maxTokens,
    currentTokens: 0,
    priorityFiles,
  };
}
