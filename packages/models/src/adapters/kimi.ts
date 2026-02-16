import type {
  ProviderAdapter,
  ChatMessage,
  ToolDefinition,
  CallConfig,
  StreamChunk,
  ModelResult,
  ErrorClassification,
  Provider,
  ToolCall,
} from '../types.js';
import { randomUUID } from 'crypto';

/**
 * Kimi (Moonshot AI) adapter configuration
 */
export interface KimiConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Kimi (Moonshot AI) provider adapter
 * API Documentation: https://platform.moonshot.cn/docs
 * Known for long context support (up to 128k tokens)
 */
export class KimiAdapter implements ProviderAdapter {
  readonly name: Provider = 'kimi';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: KimiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.moonshot.cn/v1';
    this.defaultModel = config.defaultModel ?? 'kimi-k2.5';
  }

  /**
   * Stream messages from Kimi
   */
  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): AsyncIterable<StreamChunk> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages: this.convertMessages(messages),
          tools: tools.length > 0 ? tools : undefined,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          top_p: config.topP,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let inputTokens = 0;
      let outputTokens = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;

                if (delta?.content) {
                  yield {
                    type: 'content',
                    content: delta.content,
                  };
                }

                if (parsed.usage) {
                  inputTokens = parsed.usage.prompt_tokens ?? 0;
                  outputTokens = parsed.usage.completion_tokens ?? 0;
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield {
        type: 'done',
        tokenUsage: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Make a single call to Kimi
   */
  async call(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): Promise<ModelResult> {
    const startTime = Date.now();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.defaultModel,
        messages: this.convertMessages(messages),
        tools: tools.length > 0 ? tools : undefined,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Kimi API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No response from Kimi');
    }

    const result: ModelResult = {
      content: choice.message?.content ?? '',
      tokenUsage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
        total: data.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason ?? null),
      latencyMs: Date.now() - startTime,
    };
    const toolCalls = choice.message?.tool_calls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
    if (toolCalls && toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }
    return result;
  }

  tool_call(
    toolSchema: ToolDefinition | ToolDefinition['function'],
    args: Record<string, unknown>
  ): ToolCall {
    const tool = 'function' in toolSchema ? toolSchema.function : toolSchema;
    return {
      id: randomUUID(),
      type: 'function',
      function: {
        name: tool.name,
        arguments: JSON.stringify(args),
      },
    };
  }

  /**
   * Count tokens for messages (approximate)
   * Kimi/Moonshot is optimized for Chinese but handles both well
   */
  tokenCount(messages: ChatMessage[]): number {
    let total = 0;
    for (const message of messages) {
      // Better approximation for mixed Chinese/English
      const content = message.content ?? '';
      const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
      const otherChars = content.length - chineseChars;
      total += Math.ceil(chineseChars / 1.5) + Math.ceil(otherChars / 4);
    }
    return total;
  }

  token_count(messages: ChatMessage[]): number {
    return this.tokenCount(messages);
  }

  /**
   * Classify error for retry logic
   */
  classifyError(error: Error): ErrorClassification {
    const message = error.message.toLowerCase();

    if (message.includes('rate limit') || message.includes('429') || message.includes('frequency')) {
      return {
        type: 'rate_limit',
        retryDecision: 'backoff',
        retryAfter: 1500,
      };
    }

    if (message.includes('context') || message.includes('token') || message.includes('length') || message.includes('too long')) {
      return {
        type: 'context_length',
        retryDecision: 'fail',
      };
    }

    if (message.includes('auth') || message.includes('401') || message.includes('403') || message.includes('invalid') || message.includes('key')) {
      return {
        type: 'auth',
        retryDecision: 'fail',
      };
    }

    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('overload')) {
      return {
        type: 'server',
        retryDecision: 'retry',
      };
    }

    return {
      type: 'unknown',
      retryDecision: 'fail',
    };
  }

  classify_retry(error: Error): ErrorClassification {
    return this.classifyError(error);
  }

  /**
   * Check if model supports a feature
   * Kimi is known for excellent long context support
   */
  supportsFeature(feature: 'tools' | 'streaming' | 'vision'): boolean {
    switch (feature) {
      case 'tools':
        return true;
      case 'streaming':
        return true;
      case 'vision':
        return this.defaultModel.includes('vision') || this.defaultModel.includes('kimi-vl');
      default:
        return false;
    }
  }

  /**
   * Get maximum context length for current model
   */
  getMaxContextLength(): number {
    // Kimi models support up to 128k context
    if (this.defaultModel.includes('128k') || this.defaultModel.includes('k2')) {
      return 128000;
    }
    if (this.defaultModel.includes('32k')) {
      return 32000;
    }
    return 8192; // Default 8k
  }

  /**
   * Set the default model
   */
  setModel(model: string): void {
    this.defaultModel = model;
  }

  /**
   * Get the default model
   */
  getModel(): string {
    return this.defaultModel;
  }

  /**
   * Convert internal messages to Kimi format
   */
  private convertMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Map finish reason
   */
  private mapFinishReason(reason: string | null): ModelResult['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}

/**
 * Create Kimi adapter
 */
export function createKimiAdapter(config: KimiConfig): KimiAdapter {
  return new KimiAdapter(config);
}
