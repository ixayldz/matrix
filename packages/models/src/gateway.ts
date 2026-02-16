import type {
  ProviderAdapter,
  ChatMessage,
  ToolDefinition,
  CallConfig,
  StreamChunk,
  ModelResult,
  Provider,
  GatewayConfig,
  ErrorClassification,
} from './types.js';

/**
 * Rate limit tracker
 */
interface RateLimitTracker {
  requests: number[];
  windowMs: number;
  maxRequests: number;
}

/**
 * Model quality tiers for fallback chain
 */
type ModelTier = 'premium' | 'standard' | 'economy';

/**
 * Model tier mapping
 */
const MODEL_TIERS: Record<string, ModelTier> = {
  // OpenAI
  'gpt-4o': 'premium',
  'gpt-4-turbo': 'premium',
  'gpt-4': 'premium',
  'gpt-3.5-turbo': 'standard',
  'o1': 'premium',
  'o1-mini': 'standard',
  // GLM
  'glm-4': 'premium',
  'glm-3-turbo': 'standard',
  // MiniMax
  'abab6.5-chat': 'premium',
  'abab5.5-chat': 'standard',
  // Kimi
  'moonshot-v1-8k': 'standard',
  'moonshot-v1-32k': 'premium',
  'moonshot-v1-128k': 'premium',
};

/**
 * Provider tier mapping
 */
const PROVIDER_TIERS: Record<Provider, ModelTier> = {
  openai: 'premium',
  anthropic: 'premium',
  glm: 'standard',
  minimax: 'standard',
  kimi: 'standard',
  local: 'economy',
};

/**
 * Fallback event
 */
export interface FallbackEvent {
  type: 'model.fallback';
  timestamp: number;
  fromProvider: Provider;
  fromModel?: string;
  toProvider: Provider;
  toModel?: string;
  reason: string;
  attemptNumber: number;
  error?: Error;
}

/**
 * Fallback event callback
 */
export type FallbackEventCallback = (event: FallbackEvent) => void;

/**
 * Gateway event types
 */
export type GatewayEvent = FallbackEvent;

/**
 * Gateway event callback
 */
export type GatewayEventCallback = (event: GatewayEvent) => void;

/**
 * Fallback configuration
 */
export interface FallbackConfig {
  /** Maximum retry attempts (default: 2) */
  maxRetries: number;
  /** Enable fallback chain */
  enableFallback: boolean;
  /** Providers to exclude from fallback */
  excludeProviders?: Provider[];
  /** Only fallback within same tier */
  sameTierOnly?: boolean;
}

/**
 * Model Gateway - Unified interface for multiple providers with fallback chain
 *
 * Implements PRD Section 9.2 Fallback Chain:
 * - Primary fails -> fallback to same class
 * - Same class unavailable -> upgrade to higher quality
 * - Max retries: 2
 * - Emits model.fallback event
 */
export class ModelGateway {
  private providers: Map<Provider, ProviderAdapter>;
  private defaultProvider: Provider;
  private defaultModel: string;
  private tokenBudget: number;
  private tokensUsed: number;
  private rateLimiters: Map<Provider, RateLimitTracker>;
  private eventCallbacks: GatewayEventCallback[] = [];
  private fallbackConfig: FallbackConfig;

  constructor(config: GatewayConfig) {
    this.providers = config.providers;
    this.defaultProvider = config.defaultProvider;
    this.defaultModel = config.defaultModel;
    this.tokenBudget = config.tokenBudget ?? 1000000; // 1M tokens default
    this.tokensUsed = 0;
    this.rateLimiters = new Map();
    this.fallbackConfig = {
      maxRetries: 2,
      enableFallback: true,
    };

    // Initialize rate limiters for each provider
    for (const [provider] of this.providers) {
      this.rateLimiters.set(provider, {
        requests: [],
        windowMs: config.rateLimitWindow ?? 60000, // 1 minute
        maxRequests: config.maxRequestsPerWindow ?? 100,
      });
    }
  }

  /**
   * Register event callback
   */
  onEvent(callback: GatewayEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit event to callbacks
   */
  private emitEvent(event: GatewayEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Gateway event callback error:', error);
      }
    }
  }

  /**
   * Get model tier
   */
  private getModelTier(provider: Provider, model?: string): ModelTier {
    if (model && MODEL_TIERS[model]) {
      return MODEL_TIERS[model];
    }
    return PROVIDER_TIERS[provider] || 'standard';
  }

  /**
   * Get fallback providers in order
   */
  private getFallbackProviders(
    failedProvider: Provider,
    failedModel?: string,
    excludeProviders: Provider[] = []
  ): Provider[] {
    const tier = this.getModelTier(failedProvider, failedModel);
    const available = Array.from(this.providers.keys())
      .filter(p => p !== failedProvider && !excludeProviders.includes(p));

    if (this.fallbackConfig.sameTierOnly) {
      // Only same tier
      return available.filter(p => this.getModelTier(p) === tier);
    }

    // Sort by tier: same tier first, then higher tiers
    const tierOrder: ModelTier[] = [tier, 'premium', 'standard', 'economy'];
    const uniqueTiers = [...new Set(tierOrder)];

    const sorted: Provider[] = [];
    for (const t of uniqueTiers) {
      sorted.push(...available.filter(p => this.getModelTier(p) === t));
    }

    return sorted;
  }

  /**
   * Register a provider
   */
  registerProvider(adapter: ProviderAdapter): void {
    this.providers.set(adapter.name, adapter);
  }

  /**
   * Get a provider by name
   */
  getProvider(name: Provider): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  /**
   * Get default provider
   */
  getDefaultProvider(): ProviderAdapter {
    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Default provider ${this.defaultProvider} not found`);
    }
    return provider;
  }

  /**
   * Update fallback configuration
   */
  setFallbackConfig(config: Partial<FallbackConfig>): void {
    this.fallbackConfig = { ...this.fallbackConfig, ...config };
  }

  /**
   * Stream from a specific provider with fallback
   */
  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig = {},
    provider?: Provider
  ): AsyncIterable<StreamChunk> {
    const adapter = provider
      ? this.providers.get(provider)
      : this.getDefaultProvider();

    if (!adapter) {
      yield { type: 'error', error: `Provider ${provider} not found` };
      return;
    }

    // Check rate limit
    if (!this.checkRateLimit(adapter.name)) {
      // Try fallback
      const fallbackProviders = this.getFallbackProviders(adapter.name);
      if (fallbackProviders.length > 0) {
        this.emitEvent({
          type: 'model.fallback',
          timestamp: Date.now(),
          fromProvider: adapter.name,
          toProvider: fallbackProviders[0]!,
          reason: 'Rate limit exceeded',
          attemptNumber: 1,
        });

        yield* this.stream(messages, tools, config, fallbackProviders[0]);
        return;
      }

      yield { type: 'error', error: 'Rate limit exceeded' };
      return;
    }

    // Track request
    this.trackRequest(adapter.name);

    try {
      // Stream from provider
      for await (const chunk of adapter.stream(messages, tools, config)) {
        // Track token usage
        if (chunk.tokenUsage) {
          this.tokensUsed += chunk.tokenUsage.total;
        }

        yield chunk;
      }
    } catch (error) {
      // Attempt fallback
      const fallbackResult = await this.attemptFallback(
        error instanceof Error ? error : new Error(String(error)),
        adapter.name,
        messages,
        tools,
        config,
        1
      );

      if (fallbackResult.success && fallbackResult.stream) {
        yield* fallbackResult.stream;
      } else {
        yield {
          type: 'error',
          error: fallbackResult.error || 'Stream failed after fallback attempts',
        };
      }
    }
  }

  /**
   * Call a specific provider with fallback chain
   */
  async call(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig = {},
    provider?: Provider
  ): Promise<ModelResult> {
    const adapter = provider
      ? this.providers.get(provider)
      : this.getDefaultProvider();

    if (!adapter) {
      throw new Error(`Provider ${provider ?? this.defaultProvider} not found`);
    }

    return this.callWithFallback(messages, tools, config, adapter.name, 0, []);
  }

  /**
   * Call with fallback chain logic
   */
  private async callWithFallback(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig,
    providerName: Provider,
    attempt: number,
    failedProviders: Provider[]
  ): Promise<ModelResult> {
    const adapter = this.providers.get(providerName);
    if (!adapter) {
      throw new Error(`Provider ${providerName} not found`);
    }

    // Check rate limit
    if (!this.checkRateLimit(adapter.name)) {
      const error = new Error('Rate limit exceeded');
      return this.handleFallback(
        error,
        adapter.name,
        messages,
        tools,
        config,
        attempt,
        failedProviders
      );
    }

    // Check token budget
    const estimatedTokens = adapter.tokenCount(messages);
    if (this.tokensUsed + estimatedTokens > this.tokenBudget) {
      throw new Error('Token budget exceeded');
    }

    // Track request
    this.trackRequest(adapter.name);

    try {
      // Make call
      const result = await adapter.call(messages, tools, config);

      // Track token usage
      this.tokensUsed += result.tokenUsage.total;

      return result;
    } catch (error) {
      return this.handleFallback(
        error instanceof Error ? error : new Error(String(error)),
        adapter.name,
        messages,
        tools,
        config,
        attempt,
        failedProviders
      );
    }
  }

  /**
   * Handle fallback logic
   */
  private async handleFallback(
    error: Error,
    failedProvider: Provider,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig,
    attempt: number,
    failedProviders: Provider[]
  ): Promise<ModelResult> {
    // Check if we should attempt fallback
    if (!this.fallbackConfig.enableFallback || attempt >= this.fallbackConfig.maxRetries) {
      throw error;
    }

    // Classify error to decide on fallback
    const adapter = this.providers.get(failedProvider);
    const classification = adapter?.classifyError(error);

    // Only fallback on certain error types
    if (classification && !this.shouldFallback(classification)) {
      throw error;
    }

    // Get fallback provider
    const excludeList = [...failedProviders, failedProvider, ...(this.fallbackConfig.excludeProviders || [])];
    const fallbackProviders = this.getFallbackProviders(failedProvider, undefined, excludeList);

    if (fallbackProviders.length === 0) {
      throw new Error(`No fallback providers available after ${failedProvider} failed: ${error.message}`);
    }

    const fallbackProvider = fallbackProviders[0]!;

    // Emit fallback event
    this.emitEvent({
      type: 'model.fallback',
      timestamp: Date.now(),
      fromProvider: failedProvider,
      toProvider: fallbackProvider,
      reason: error.message,
      attemptNumber: attempt + 1,
      error,
    });

    // Retry with fallback provider
    return this.callWithFallback(
      messages,
      tools,
      config,
      fallbackProvider,
      attempt + 1,
      [...failedProviders, failedProvider]
    );
  }

  /**
   * Attempt fallback for streaming
   */
  private async attemptFallback(
    error: Error,
    failedProvider: Provider,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig,
    attempt: number
  ): Promise<{ success: boolean; stream?: AsyncIterable<StreamChunk>; error?: string }> {
    if (!this.fallbackConfig.enableFallback || attempt >= this.fallbackConfig.maxRetries) {
      return { success: false, error: error.message };
    }

    const excludeList = [failedProvider, ...(this.fallbackConfig.excludeProviders || [])];
    const fallbackProviders = this.getFallbackProviders(failedProvider, undefined, excludeList);

    if (fallbackProviders.length === 0) {
      return { success: false, error: `No fallback providers available: ${error.message}` };
    }

    const fallbackProvider = fallbackProviders[0]!;

    // Emit fallback event
    this.emitEvent({
      type: 'model.fallback',
      timestamp: Date.now(),
      fromProvider: failedProvider,
      toProvider: fallbackProvider,
      reason: error.message,
      attemptNumber: attempt + 1,
      error,
    });

    // Get fallback adapter
    const fallbackAdapter = this.providers.get(fallbackProvider);
    if (!fallbackAdapter) {
      return { success: false, error: `Fallback provider ${fallbackProvider} not found` };
    }

    // Check rate limit for fallback
    if (!this.checkRateLimit(fallbackProvider)) {
      // Try next fallback
      return this.attemptFallback(
        new Error(`Rate limit exceeded for ${fallbackProvider}`),
        fallbackProvider,
        messages,
        tools,
        config,
        attempt + 1
      );
    }

    // Track request
    this.trackRequest(fallbackProvider);

    // Return stream generator
    return {
      success: true,
      stream: this.wrapStreamWithFallback(
        fallbackAdapter.stream(messages, tools, config),
        fallbackProvider,
        messages,
        tools,
        config,
        attempt + 1
      ),
    };
  }

  /**
   * Wrap stream with fallback support
   */
  private async *wrapStreamWithFallback(
    stream: AsyncIterable<StreamChunk>,
    provider: Provider,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig,
    attempt: number
  ): AsyncIterable<StreamChunk> {
    try {
      for await (const chunk of stream) {
        if (chunk.tokenUsage) {
          this.tokensUsed += chunk.tokenUsage.total;
        }
        yield chunk;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Try next fallback
      if (attempt < this.fallbackConfig.maxRetries) {
        const fallbackResult = await this.attemptFallback(
          error instanceof Error ? error : new Error(errorMsg),
          provider,
          messages,
          tools,
          config,
          attempt
        );

        if (fallbackResult.success && fallbackResult.stream) {
          yield* fallbackResult.stream;
          return;
        }
      }

      yield { type: 'error', error: errorMsg };
    }
  }

  /**
   * Determine if error should trigger fallback
   */
  private shouldFallback(classification: ErrorClassification): boolean {
    switch (classification.type) {
      case 'rate_limit':
      case 'server':
        return true;
      case 'context_length':
      case 'auth':
      case 'unknown':
      default:
        return false;
    }
  }

  /**
   * Get token usage stats
   */
  getTokenUsage(): { used: number; budget: number; remaining: number } {
    return {
      used: this.tokensUsed,
      budget: this.tokenBudget,
      remaining: Math.max(0, this.tokenBudget - this.tokensUsed),
    };
  }

  /**
   * Reset token usage
   */
  resetTokenUsage(): void {
    this.tokensUsed = 0;
  }

  /**
   * Set token budget
   */
  setTokenBudget(budget: number): void {
    this.tokenBudget = budget;
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Provider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider is available
   */
  hasProvider(name: Provider): boolean {
    return this.providers.has(name);
  }

  /**
   * Set default provider
   */
  setDefaultProvider(name: Provider): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} not found`);
    }
    this.defaultProvider = name;
  }

  /**
   * Set default model
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  /**
   * Get default model
   */
  getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(provider: Provider): boolean {
    const limiter = this.rateLimiters.get(provider);
    if (!limiter) return true;

    const now = Date.now();
    const windowStart = now - limiter.windowMs;

    // Remove old requests
    limiter.requests = limiter.requests.filter((t) => t > windowStart);

    return limiter.requests.length < limiter.maxRequests;
  }

  /**
   * Track a request
   */
  private trackRequest(provider: Provider): void {
    const limiter = this.rateLimiters.get(provider);
    if (limiter) {
      limiter.requests.push(Date.now());
    }
  }
}

/**
 * Create a model gateway
 */
export function createModelGateway(config: GatewayConfig): ModelGateway {
  return new ModelGateway(config);
}
