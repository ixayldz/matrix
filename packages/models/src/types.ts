/**
 * Provider types
 */
export type Provider = 'openai' | 'anthropic' | 'glm' | 'minimax' | 'kimi' | 'local';

/**
 * Message types for LLM communication
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tool definition for LLM
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Call configuration
 */
export interface CallConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

/**
 * Stream chunk
 */
export interface StreamChunk {
  type: 'content' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
  tokenUsage?: TokenUsage;
}

/**
 * Token usage
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Model call result
 */
export interface ModelResult {
  content: string;
  toolCalls?: ToolCall[];
  tokenUsage: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  latencyMs: number;
}

/**
 * Retry decision
 */
export type RetryDecision = 'retry' | 'backoff' | 'fail';

/**
 * Error classification
 */
export interface ErrorClassification {
  type: 'rate_limit' | 'context_length' | 'auth' | 'server' | 'unknown';
  retryDecision: RetryDecision;
  retryAfter?: number;
}

/**
 * Provider adapter interface
 */
export interface ProviderAdapter {
  readonly name: Provider;

  /**
   * Stream messages from the model
   */
  stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): AsyncIterable<StreamChunk>;

  /**
   * Make a single call to the model
   */
  call(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): Promise<ModelResult>;

  /**
   * Normalize tool call payload shape across providers (PRD Section 21.5).
   */
  tool_call(
    toolSchema: ToolDefinition | ToolDefinition['function'],
    args: Record<string, unknown>
  ): ToolCall;

  /**
   * Count tokens for messages
   */
  tokenCount(messages: ChatMessage[]): number;

  /**
   * Alias for contract compatibility (PRD Section 21.5).
   */
  token_count(messages: ChatMessage[]): number;

  /**
   * Classify error for retry logic
   */
  classifyError(error: Error): ErrorClassification;

  /**
   * Alias for contract compatibility (PRD Section 21.5).
   */
  classify_retry(error: Error): ErrorClassification;

  /**
   * Check if model supports a feature
   */
  supportsFeature(feature: 'tools' | 'streaming' | 'vision'): boolean;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: Provider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  defaultConfig?: CallConfig;
}

/**
 * Task type for smart routing
 */
export type TaskType = 'reasoning' | 'codegen' | 'review' | 'cheap' | 'fast' | 'long_context' | 'tool_use';

/**
 * Routing rule
 */
export interface RoutingRule {
  taskType: TaskType;
  provider: Provider;
  model: string;
  config?: CallConfig;
}

/**
 * Gateway config
 */
export interface GatewayConfig {
  providers: Map<Provider, ProviderAdapter>;
  defaultProvider: Provider;
  defaultModel: string;
  routingRules: RoutingRule[];
  tokenBudget?: number;
  rateLimitWindow?: number;
  maxRequestsPerWindow?: number;
}
