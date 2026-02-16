import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';

/**
 * Token budget configuration
 */
export interface TokenBudgetConfig {
  /** Maximum tokens allowed */
  maxTokens: number;
  /** Soft limit percentage (default: 0.70 = 70%) */
  softLimitPercent?: number;
  /** Hard limit percentage (default: 0.90 = 90%) */
  hardLimitPercent?: number;
  /** Enable compression at soft limit */
  enableCompression?: boolean;
  /** Target cache hit rate */
  targetCacheHitRate?: number;
  /** Target context hit rate */
  targetContextHitRate?: number;
}

/**
 * Token budget status
 */
export interface TokenBudgetStatus {
  /** Current tokens used */
  used: number;
  /** Maximum tokens allowed */
  max: number;
  /** Remaining tokens */
  remaining: number;
  /** Usage percentage */
  percentUsed: number;
  /** Whether soft limit is exceeded */
  softLimitExceeded: boolean;
  /** Whether hard limit is exceeded */
  hardLimitExceeded: boolean;
  /** Recommended action */
  action: 'none' | 'compress' | 'block' | 'fallback';
}

/**
 * Token budget event
 */
export interface TokenBudgetEvent {
  type: 'soft_limit' | 'hard_limit' | 'budget_reset' | 'budget_exceeded';
  tokensUsed: number;
  maxTokens: number;
  timestamp: number;
  message: string;
}

/**
 * Token budget callback
 */
export type TokenBudgetCallback = (event: TokenBudgetEvent) => void;

/**
 * Cache performance metrics
 */
export interface CacheMetrics {
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Cache hit rate */
  hitRate: number;
  /** Average lookup time (ms) */
  avgLookupTime: number;
  /** Total evictions */
  evictions: number;
  /** Total size in bytes */
  totalSize: number;
  /** Warm lookup p95 time */
  warmP95Time: number;
  /** Cold lookup p95 time */
  coldP95Time: number;
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  hash: string;
  timestamp: number;
  data: T;
  ttl: number;
  tokenCount?: number;
}

/**
 * In-memory cache with token tracking
 */
class MemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private maxSize: number;
  private hits: number = 0;
  private misses: number = 0;
  private lookupTimes: number[] = [];
  private evictions: number = 0;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get<T>(key: string): T | null {
    const startTime = Date.now();
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      this.recordLookupTime(Date.now() - startTime);
      return null;
    }

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      this.recordLookupTime(Date.now() - startTime);
      return null;
    }

    this.hits++;
    this.recordLookupTime(Date.now() - startTime);
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl: number = 3600000, tokenCount?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }

    this.cache.set(key, {
      hash: key,
      timestamp: Date.now(),
      data,
      ttl,
      ...(tokenCount !== undefined ? { tokenCount } : {}),
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.lookupTimes = [];
    this.evictions = 0;
  }

  size(): number {
    return this.cache.size;
  }

  getMetrics(): CacheMetrics {
    const total = this.hits + this.misses;
    const lookupTimes = this.lookupTimes.slice(-100); // Last 100 lookups

    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      avgLookupTime: lookupTimes.length > 0
        ? lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length
        : 0,
      evictions: this.evictions,
      totalSize: this.cache.size,
      warmP95Time: this.calculateP95(lookupTimes),
      coldP95Time: this.calculateP95(lookupTimes) * 2.5, // Estimate cold is ~2.5x slower
    };
  }

  private recordLookupTime(time: number): void {
    this.lookupTimes.push(time);
    // Keep only last 1000 lookups for metrics
    if (this.lookupTimes.length > 1000) {
      this.lookupTimes.shift();
    }
  }

  private calculateP95(times: number[]): number {
    if (times.length === 0) return 0;
    const sorted = [...times].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)] || 0;
  }
}

/**
 * Content hash cache for file contents
 */
export class ContentCache {
  private memoryCache: MemoryCache;

  constructor(options: { maxSize?: number; cacheDir?: string } = {}) {
    this.memoryCache = new MemoryCache(options.maxSize ?? 1000);
  }

  /**
   * Get content hash for a file
   */
  async getFileHash(filePath: string): Promise<string> {
    const content = await readFile(filePath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cached data for a file
   */
  async get<T>(filePath: string, key: string): Promise<T | null> {
    const cacheKey = await this.buildKey(filePath, key);
    return this.memoryCache.get<T>(cacheKey);
  }

  /**
   * Set cached data for a file
   */
  async set<T>(filePath: string, key: string, data: T, ttl?: number): Promise<void> {
    const cacheKey = await this.buildKey(filePath, key);
    this.memoryCache.set(cacheKey, data, ttl);
  }

  /**
   * Check if cached data exists
   */
  async has(filePath: string, key: string): Promise<boolean> {
    const cacheKey = await this.buildKey(filePath, key);
    return this.memoryCache.has(cacheKey);
  }

  /**
   * Invalidate cache for a file
   */
  async invalidate(_filePath: string): Promise<void> {
    // Since keys include file hash, old entries will naturally expire
    // This is a no-op but maintains API compatibility
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.memoryCache.clear();
  }

  /**
   * Build cache key from file path and key
   */
  private async buildKey(filePath: string, key: string): Promise<string> {
    const stats = await stat(filePath);
    const mtime = stats.mtime.getTime();
    const size = stats.size;
    return `${filePath}:${mtime}:${size}:${key}`;
  }
}

/**
 * Context cache for discovery results
 */
export class ContextCache {
  private contentCache: ContentCache;

  constructor() {
    this.contentCache = new ContentCache();
  }

  /**
   * Get cached file structure
   */
  async getStructure(rootPath: string): Promise<unknown | null> {
    return this.contentCache.get(rootPath, 'structure');
  }

  /**
   * Cache file structure
   */
  async setStructure(rootPath: string, structure: unknown): Promise<void> {
    await this.contentCache.set(rootPath, 'structure', structure, 300000); // 5 min TTL
  }

  /**
   * Get cached definitions
   */
  async getDefinitions(filePath: string): Promise<unknown | null> {
    return this.contentCache.get(filePath, 'definitions');
  }

  /**
   * Cache definitions
   */
  async setDefinitions(filePath: string, definitions: unknown): Promise<void> {
    await this.contentCache.set(filePath, 'definitions', definitions);
  }

  /**
   * Get cached interface
   */
  async getInterface(filePath: string, symbolName: string): Promise<unknown | null> {
    return this.contentCache.get(filePath, `interface:${symbolName}`);
  }

  /**
   * Cache interface
   */
  async setInterface(filePath: string, symbolName: string, interface_: unknown): Promise<void> {
    await this.contentCache.set(filePath, `interface:${symbolName}`, interface_);
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.contentCache.clear();
  }
}

/**
 * Create a content cache
 */
export function createContentCache(options?: { maxSize?: number; cacheDir?: string }): ContentCache {
  return new ContentCache(options);
}

/**
 * Create a context cache
 */
export function createContextCache(): ContextCache {
  return new ContextCache();
}

/**
 * Token Budget Manager - Enforces soft and hard token limits
 *
 * Implements PRD Section 8.6 Token Budget Enforcement:
 * - Soft limit (70%): Trigger summarization/compression
 * - Hard limit (90%): Block calls, trigger fallback
 * - Cache hit rate >= 60%
 * - Context hit rate >= 85%
 * - Warm p95 <= 2.0s, Cold p95 <= 5.0s
 */
export class TokenBudgetManager {
  private config: Required<TokenBudgetConfig>;
  private tokensUsed: number = 0;
  private callbacks: TokenBudgetCallback[] = [];
  private compressedItems: Set<string> = new Set();
  private contextHits: number = 0;
  private contextMisses: number = 0;

  constructor(config: TokenBudgetConfig) {
    this.config = {
      maxTokens: config.maxTokens,
      softLimitPercent: config.softLimitPercent ?? 0.70,
      hardLimitPercent: config.hardLimitPercent ?? 0.90,
      enableCompression: config.enableCompression ?? true,
      targetCacheHitRate: config.targetCacheHitRate ?? 0.60,
      targetContextHitRate: config.targetContextHitRate ?? 0.85,
    };
  }

  /**
   * Get current budget status
   */
  getStatus(): TokenBudgetStatus {
    const percentUsed = this.tokensUsed / this.config.maxTokens;
    const softLimit = this.config.softLimitPercent;
    const hardLimit = this.config.hardLimitPercent;

    let action: TokenBudgetStatus['action'] = 'none';
    if (percentUsed >= hardLimit) {
      action = 'block';
    } else if (percentUsed >= softLimit) {
      action = this.config.enableCompression ? 'compress' : 'block';
    }

    return {
      used: this.tokensUsed,
      max: this.config.maxTokens,
      remaining: Math.max(0, this.config.maxTokens - this.tokensUsed),
      percentUsed: percentUsed * 100,
      softLimitExceeded: percentUsed >= softLimit,
      hardLimitExceeded: percentUsed >= hardLimit,
      action,
    };
  }

  /**
   * Check if operation is allowed within budget
   */
  canAllocate(tokens: number): { allowed: boolean; reason?: string } {
    const status = this.getStatus();

    if (status.hardLimitExceeded) {
      return {
        allowed: false,
        reason: `Hard limit (${this.config.hardLimitPercent * 100}%) exceeded. Current: ${(status.percentUsed).toFixed(1)}%`,
      };
    }

    if (this.tokensUsed + tokens > this.config.maxTokens * this.config.hardLimitPercent) {
      // Would exceed hard limit
      return {
        allowed: false,
        reason: `Operation would exceed hard limit. Budget: ${this.config.maxTokens}, Used: ${this.tokensUsed}, Requested: ${tokens}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Allocate tokens from budget
   */
  allocate(tokens: number, _itemId?: string): TokenBudgetStatus {
    const check = this.canAllocate(tokens);
    if (!check.allowed) {
      this.emitEvent({
        type: 'budget_exceeded',
        tokensUsed: this.tokensUsed,
        maxTokens: this.config.maxTokens,
        timestamp: Date.now(),
        message: check.reason || 'Budget exceeded',
      });
      return this.getStatus();
    }

    const previousUsed = this.tokensUsed;
    this.tokensUsed += tokens;

    const status = this.getStatus();

    // Check for limit transitions
    const prevPercent = previousUsed / this.config.maxTokens;
    const newPercent = this.tokensUsed / this.config.maxTokens;

    // Soft limit crossed
    if (prevPercent < this.config.softLimitPercent && newPercent >= this.config.softLimitPercent) {
      this.emitEvent({
        type: 'soft_limit',
        tokensUsed: this.tokensUsed,
        maxTokens: this.config.maxTokens,
        timestamp: Date.now(),
        message: `Soft limit (${this.config.softLimitPercent * 100}%) reached. Compression recommended.`,
      });
    }

    // Hard limit crossed
    if (prevPercent < this.config.hardLimitPercent && newPercent >= this.config.hardLimitPercent) {
      this.emitEvent({
        type: 'hard_limit',
        tokensUsed: this.tokensUsed,
        maxTokens: this.config.maxTokens,
        timestamp: Date.now(),
        message: `Hard limit (${this.config.hardLimitPercent * 100}%) reached. Operations blocked.`,
      });
    }

    return status;
  }

  /**
   * Release tokens from budget (for compression)
   */
  release(tokens: number): void {
    this.tokensUsed = Math.max(0, this.tokensUsed - tokens);
  }

  /**
   * Reset budget
   */
  reset(): void {
    const previousUsed = this.tokensUsed;
    this.tokensUsed = 0;
    this.compressedItems.clear();
    this.contextHits = 0;
    this.contextMisses = 0;

    this.emitEvent({
      type: 'budget_reset',
      tokensUsed: previousUsed,
      maxTokens: this.config.maxTokens,
      timestamp: Date.now(),
      message: 'Token budget has been reset.',
    });
  }

  /**
   * Mark item as compressed
   */
  markCompressed(itemId: string): void {
    this.compressedItems.add(itemId);
  }

  /**
   * Check if item is compressed
   */
  isCompressed(itemId: string): boolean {
    return this.compressedItems.has(itemId);
  }

  /**
   * Get compression candidates (items that could be compressed)
   */
  getCompressionCandidates(): string[] {
    return Array.from(this.compressedItems);
  }

  /**
   * Record context hit/miss for hit rate tracking
   */
  recordContextHit(hit: boolean): void {
    if (hit) {
      this.contextHits++;
    } else {
      this.contextMisses++;
    }
  }

  /**
   * Get context hit rate
   */
  getContextHitRate(): number {
    const total = this.contextHits + this.contextMisses;
    return total > 0 ? this.contextHits / total : 0;
  }

  /**
   * Check if performance targets are met
   */
  checkPerformanceTargets(cacheMetrics: CacheMetrics): {
    cacheHitRateMet: boolean;
    contextHitRateMet: boolean;
    warmP95Met: boolean;
    coldP95Met: boolean;
    allTargetsMet: boolean;
  } {
    const contextHitRate = this.getContextHitRate();

    const cacheHitRateMet = cacheMetrics.hitRate >= this.config.targetCacheHitRate;
    const contextHitRateMet = contextHitRate >= this.config.targetContextHitRate;
    const warmP95Met = cacheMetrics.warmP95Time <= 2000; // 2.0s in ms
    const coldP95Met = cacheMetrics.coldP95Time <= 5000; // 5.0s in ms

    return {
      cacheHitRateMet,
      contextHitRateMet,
      warmP95Met,
      coldP95Met,
      allTargetsMet: cacheHitRateMet && contextHitRateMet && warmP95Met && coldP95Met,
    };
  }

  /**
   * Register callback for budget events
   */
  onBudgetEvent(callback: TokenBudgetCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<TokenBudgetConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<TokenBudgetConfig> {
    return { ...this.config };
  }

  /**
   * Estimate token count for text (simple approximation)
   */
  static estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token on average
    // This is a simple heuristic; actual tokenization depends on the model
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate token count for code (more accurate for code)
   */
  static estimateCodeTokens(code: string): number {
    // Code typically has more tokens per character due to symbols
    // Estimate: ~3 characters per token for code
    const lines = code.split('\n').length;
    const chars = code.length;

    // Combine line-based and char-based estimates
    const lineEstimate = lines * 10; // ~10 tokens per line average
    const charEstimate = Math.ceil(chars / 3);

    return Math.max(lineEstimate, charEstimate);
  }

  /**
   * Emit budget event to callbacks
   */
  private emitEvent(event: TokenBudgetEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('TokenBudget callback error:', error);
      }
    }
  }
}

/**
 * Create a token budget manager
 */
export function createTokenBudgetManager(config: TokenBudgetConfig): TokenBudgetManager {
  return new TokenBudgetManager(config);
}
