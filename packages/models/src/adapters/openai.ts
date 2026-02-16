import OpenAI from 'openai';
import { randomUUID } from 'crypto';
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

/**
 * OpenAI adapter configuration
 */
export interface OpenAIConfig {
  apiKey: string;
  organization?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * OpenAI provider adapter
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly name: Provider = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      organization: config.organization,
      baseURL: config.baseUrl,
    });
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
  }

  /**
   * Stream messages from OpenAI
   */
  async *stream(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): AsyncIterable<StreamChunk> {
    try {
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: this.defaultModel,
        messages: this.convertMessages(messages),
        stream: true,
        ...(tools.length > 0 ? { tools } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
        ...(config.topP !== undefined ? { top_p: config.topP } : {}),
        ...(config.stop !== undefined ? { stop: config.stop } : {}),
        ...(config.frequencyPenalty !== undefined ? { frequency_penalty: config.frequencyPenalty } : {}),
        ...(config.presencePenalty !== undefined ? { presence_penalty: config.presencePenalty } : {}),
      };

      const stream = await this.client.chat.completions.create(request);

      let inputTokens = 0;
      let outputTokens = 0;
      const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      for await (const chunk of stream) {
        // Update token usage if available
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }

        const delta = chunk.choices[0]?.delta;

        if (!delta) continue;

        // Handle content
        if (delta.content) {
          yield {
            type: 'content',
            content: delta.content,
          };
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            const existing = toolCalls.get(index);

            if (toolCall.id) {
              toolCalls.set(index, {
                id: toolCall.id,
                name: existing?.name ?? toolCall.function?.name ?? '',
                arguments: existing?.arguments ?? '',
              });
            }

            if (toolCall.function?.name) {
              const current = toolCalls.get(index);
              if (current) {
                current.name = toolCall.function.name;
              }
            }

            if (toolCall.function?.arguments) {
              const current = toolCalls.get(index);
              if (current) {
                current.arguments += toolCall.function.arguments;
              }
            }

            yield {
              type: 'tool_call',
              toolCall: {
                type: 'function',
                function: {
                  name: toolCall.function?.name ?? toolCalls.get(index)?.name ?? '',
                  arguments: toolCall.function?.arguments ?? '',
                },
                ...(toolCall.id !== undefined || toolCalls.get(index)?.id !== undefined
                  ? { id: toolCall.id ?? toolCalls.get(index)!.id }
                  : {}),
              },
            };
          }
        }
      }

      // Yield final chunk with token usage
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
   * Make a single call to OpenAI
   */
  async call(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    config: CallConfig
  ): Promise<ModelResult> {
    const startTime = Date.now();

    const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.defaultModel,
      messages: this.convertMessages(messages),
      stream: false,
      ...(tools.length > 0 ? { tools } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
      ...(config.topP !== undefined ? { top_p: config.topP } : {}),
      ...(config.stop !== undefined ? { stop: config.stop } : {}),
      ...(config.frequencyPenalty !== undefined ? { frequency_penalty: config.frequencyPenalty } : {}),
      ...(config.presencePenalty !== undefined ? { presence_penalty: config.presencePenalty } : {}),
    };

    const response = await this.client.chat.completions.create(request);

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const result: ModelResult = {
      content: choice.message.content ?? '',
      tokenUsage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
        total: response.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
      latencyMs: Date.now() - startTime,
    };
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
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
   */
  tokenCount(messages: ChatMessage[]): number {
    // Simple approximation: ~4 chars per token
    let total = 0;
    for (const message of messages) {
      total += Math.ceil((message.content?.length ?? 0) / 4);
      if (message.toolCalls) {
        for (const tc of message.toolCalls) {
          total += Math.ceil((tc.function.arguments.length) / 4);
        }
      }
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

    if (message.includes('rate limit') || message.includes('429')) {
      return {
        type: 'rate_limit',
        retryDecision: 'backoff',
        retryAfter: this.extractRetryAfter(error),
      };
    }

    if (message.includes('context') || message.includes('token') || message.includes('length')) {
      return {
        type: 'context_length',
        retryDecision: 'fail',
      };
    }

    if (message.includes('auth') || message.includes('401') || message.includes('403')) {
      return {
        type: 'auth',
        retryDecision: 'fail',
      };
    }

    if (message.includes('500') || message.includes('502') || message.includes('503')) {
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
   */
  supportsFeature(feature: 'tools' | 'streaming' | 'vision'): boolean {
    switch (feature) {
      case 'tools':
        return true;
      case 'streaming':
        return true;
      case 'vision':
        return this.defaultModel.includes('vision') || this.defaultModel.includes('gpt-4o');
      default:
        return false;
    }
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
   * Convert internal messages to OpenAI format
   */
  private convertMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return { role: 'system', content: msg.content };
        case 'user':
          return { role: 'user', content: msg.content };
        case 'assistant': {
          const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
            role: 'assistant',
            content: msg.content,
          };
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            assistantMessage.tool_calls = msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            }));
          }
          return assistantMessage;
        }
        case 'tool':
          if (!msg.toolCallId) {
            return { role: 'user', content: msg.content };
          }
          return {
            role: 'tool',
            tool_call_id: msg.toolCallId,
            content: msg.content,
          };
        default:
          return { role: 'user', content: msg.content };
      }
    });
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

  /**
   * Extract retry-after from error
   */
  private extractRetryAfter(error: Error): number {
    // Try to extract from error message
    const match = error.message.match(/retry.?after.?(\d+)/i);
    if (match) {
      return parseInt(match[1] ?? '1', 10) * 1000;
    }
    return 1000; // Default 1 second
  }
}

/**
 * Create OpenAI adapter
 */
export function createOpenAIAdapter(config: OpenAIConfig): OpenAIAdapter {
  return new OpenAIAdapter(config);
}
