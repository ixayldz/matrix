import type {
  Provider,
  TaskType,
  RoutingRule,
  CallConfig,
} from './types.js';
import type { ModelGateway } from './gateway.js';

/**
 * Default routing rules - PRD Section 4.4
 * Models: gpt-5.3-codex (OpenAI), glm-5 (GLM), minimax-2.5 (MiniMax), kimi-k2.5 (Kimi)
 */
export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  { taskType: 'reasoning', provider: 'openai', model: 'gpt-5.3-codex', config: { temperature: 0.7, maxTokens: 4096 } },
  { taskType: 'codegen', provider: 'openai', model: 'gpt-5.3-codex', config: { temperature: 0.2, maxTokens: 8192 } },
  { taskType: 'review', provider: 'openai', model: 'gpt-5.3-codex', config: { temperature: 0.3, maxTokens: 4096 } },
  { taskType: 'cheap', provider: 'glm', model: 'glm-5', config: { temperature: 0.5, maxTokens: 4096 } },
  { taskType: 'fast', provider: 'glm', model: 'glm-5', config: { temperature: 0.5, maxTokens: 2048 } },
  { taskType: 'long_context', provider: 'kimi', model: 'kimi-k2.5', config: { temperature: 0.3, maxTokens: 128000 } },
  { taskType: 'tool_use', provider: 'openai', model: 'gpt-5.3-codex', config: { temperature: 0.2, maxTokens: 8192 } },
];

/**
 * Smart Router - Routes tasks to appropriate models
 */
export class SmartRouter {
  private rules: Map<TaskType, RoutingRule>;
  private gateway: ModelGateway;
  private fallbackRule: RoutingRule;

  constructor(gateway: ModelGateway, customRules: RoutingRule[] = []) {
    this.gateway = gateway;
    this.rules = new Map();

    // Load default rules
    for (const rule of DEFAULT_ROUTING_RULES) {
      this.rules.set(rule.taskType, rule);
    }

    // Override with custom rules
    for (const rule of customRules) {
      this.rules.set(rule.taskType, rule);
    }

    // Set fallback rule
    this.fallbackRule = this.rules.get('codegen') ?? DEFAULT_ROUTING_RULES[1]!;
  }

  /**
   * Get routing rule for a task type
   */
  getRule(taskType: TaskType): RoutingRule {
    return this.rules.get(taskType) ?? this.fallbackRule;
  }

  /**
   * Set routing rule for a task type
   */
  setRule(rule: RoutingRule): void {
    this.rules.set(rule.taskType, rule);
  }

  /**
   * Remove routing rule for a task type
   */
  removeRule(taskType: TaskType): boolean {
    return this.rules.delete(taskType);
  }

  /**
   * Get all routing rules
   */
  getAllRules(): RoutingRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get provider for a task type
   */
  getProvider(taskType: TaskType): Provider {
    return this.getRule(taskType).provider;
  }

  /**
   * Get model for a task type
   */
  getModel(taskType: TaskType): string {
    return this.getRule(taskType).model;
  }

  /**
   * Get config for a task type
   */
  getConfig(taskType: TaskType): CallConfig {
    return this.getRule(taskType).config ?? {};
  }

  /**
   * Get the underlying gateway
   */
  getGateway(): ModelGateway {
    return this.gateway;
  }

  /**
   * Classify text to determine task type
   */
  classifyTask(text: string): TaskType {
    const lowerText = text.toLowerCase();

    // Long context indicators
    if (
      lowerText.includes('large file') ||
      lowerText.includes('entire codebase') ||
      lowerText.includes('whole project') ||
      lowerText.includes('all files') ||
      lowerText.includes('summarize all') ||
      lowerText.includes('analyze entire') ||
      lowerText.includes('long context') ||
      lowerText.length > 10000
    ) {
      return 'long_context';
    }

    // Tool use indicators
    if (
      lowerText.includes('execute') ||
      lowerText.includes('run command') ||
      lowerText.includes('use tool') ||
      lowerText.includes('call function') ||
      lowerText.includes('perform action') ||
      lowerText.includes('interact with')
    ) {
      return 'tool_use';
    }

    // Reasoning indicators
    if (
      lowerText.includes('analyze') ||
      lowerText.includes('explain') ||
      lowerText.includes('why') ||
      lowerText.includes('reasoning') ||
      lowerText.includes('think through') ||
      lowerText.includes('consider')
    ) {
      return 'reasoning';
    }

    // Code generation indicators
    if (
      lowerText.includes('implement') ||
      lowerText.includes('create') ||
      lowerText.includes('write') ||
      lowerText.includes('build') ||
      lowerText.includes('code') ||
      lowerText.includes('function') ||
      lowerText.includes('class') ||
      lowerText.includes('component')
    ) {
      return 'codegen';
    }

    // Review indicators
    if (
      lowerText.includes('review') ||
      lowerText.includes('audit') ||
      lowerText.includes('check') ||
      lowerText.includes('verify') ||
      lowerText.includes('validate') ||
      lowerText.includes('security')
    ) {
      return 'review';
    }

    // Fast/cheap indicators
    if (
      lowerText.includes('quick') ||
      lowerText.includes('simple') ||
      lowerText.includes('basic') ||
      lowerText.includes('brief')
    ) {
      return 'fast';
    }

    // Default to codegen for development tasks
    return 'codegen';
  }

  /**
   * Route based on automatic classification
   */
  route(text: string): { taskType: TaskType; rule: RoutingRule } {
    const taskType = this.classifyTask(text);
    const rule = this.getRule(taskType);
    return { taskType, rule };
  }
}

/**
 * Create a smart router
 */
export function createSmartRouter(
  gateway: ModelGateway,
  customRules?: RoutingRule[]
): SmartRouter {
  return new SmartRouter(gateway, customRules);
}
