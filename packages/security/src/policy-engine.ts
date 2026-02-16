import { COMMAND_DENYLIST, COMMAND_ALLOWLIST } from './patterns.js';
import type { PolicyDecision } from '@matrix/core';

/**
 * Policy rule definition
 */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  type: 'path' | 'command' | 'content';
  action: PolicyDecision;
  condition: (context: PolicyContext) => boolean;
  priority: number;
}

/**
 * Context for policy evaluation
 */
export interface PolicyContext {
  operation: 'read' | 'write' | 'delete' | 'exec';
  path?: string;
  command?: string;
  content?: string;
  workingDirectory: string;
  approvalMode: 'strict' | 'balanced' | 'fast';
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Policy evaluation result
 */
export interface PolicyResult {
  decision: PolicyDecision;
  matchedRules: Array<{
    rule: PolicyRule;
    reason: string;
  }>;
  requiresApproval: boolean;
  blocked: boolean;
  warnings: string[];
}

/**
 * Default policy rules
 */
const DEFAULT_RULES: PolicyRule[] = [
  // Path rules
  {
    id: 'no-write-outside-repo',
    name: 'No Write Outside Repository',
    description: 'Prevent writing files outside the repository',
    type: 'path',
    action: 'block',
    priority: 100,
    condition: (ctx) => {
      if (ctx.operation === 'read') return false;
      if (!ctx.path) return false;
      const normalizedPath = ctx.path.replace(/\\/g, '/');
      const normalizedWorkDir = ctx.workingDirectory.replace(/\\/g, '/');
      return !normalizedPath.startsWith(normalizedWorkDir);
    },
  },
  {
    id: 'no-delete-dotfiles',
    name: 'No Delete Dotfiles',
    description: 'Prevent deleting hidden configuration files',
    type: 'path',
    action: 'block',
    priority: 90,
    condition: (ctx) => {
      if (ctx.operation !== 'delete') return false;
      if (!ctx.path) return false;
      const fileName = ctx.path.split(/[/\\]/).pop() ?? '';
      return fileName.startsWith('.') && !fileName.startsWith('.matrix');
    },
  },

  // Command rules
  {
    id: 'no-dangerous-commands',
    name: 'No Dangerous Commands',
    description: 'Block potentially destructive commands',
    type: 'command',
    action: 'block',
    priority: 100,
    condition: (ctx) => {
      if (ctx.operation !== 'exec' || !ctx.command) return false;
      return COMMAND_DENYLIST.some((pattern) => pattern.test(ctx.command!));
    },
  },
  {
    id: 'fast-mode-allowlist',
    name: 'Fast Mode Allowlist',
    description: 'Allow safe commands in fast mode',
    type: 'command',
    action: 'allow',
    priority: 80,
    condition: (ctx) => {
      if (ctx.approvalMode !== 'fast') return false;
      if (ctx.operation !== 'exec' || !ctx.command) return false;
      return COMMAND_ALLOWLIST.some((pattern) => pattern.test(ctx.command!));
    },
  },
  {
    id: 'needs-approval-in-balanced',
    name: 'Needs Approval in Balanced Mode',
    description: 'Commands need approval in balanced mode',
    type: 'command',
    action: 'needs_approval',
    priority: 50,
    condition: (ctx) => {
      if (ctx.approvalMode !== 'balanced') return false;
      if (ctx.operation !== 'exec' || !ctx.command) return false;
      // All non-allowlisted commands need approval
      return !COMMAND_ALLOWLIST.some((pattern) => pattern.test(ctx.command!));
    },
  },

  // Strict mode rules
  {
    id: 'strict-needs-approval',
    name: 'Strict Mode Requires Approval',
    description: 'All operations need approval in strict mode',
    type: 'path',
    action: 'needs_approval',
    priority: 40,
    condition: (ctx) => {
      return ctx.approvalMode === 'strict' && ctx.operation !== 'read';
    },
  },
];

/**
 * Policy Engine - Evaluates operations against security rules
 */
export class PolicyEngine {
  private rules: Map<string, PolicyRule>;
  private decisionPriority: PolicyDecision[] = ['block', 'needs_approval', 'warn', 'allow'];

  constructor(initialRules: PolicyRule[] = []) {
    this.rules = new Map();
    this.addRules([...DEFAULT_RULES, ...initialRules]);
  }

  /**
   * Add a rule
   */
  addRule(rule: PolicyRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Add multiple rules
   */
  addRules(rules: PolicyRule[]): void {
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  /**
   * Remove a rule
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all rules
   */
  getRules(): PolicyRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Evaluate a context against all rules
   */
  evaluate(context: PolicyContext): PolicyResult {
    const matchedRules: PolicyResult['matchedRules'] = [];
    const warnings: string[] = [];

    // Sort rules by priority (descending)
    const sortedRules = Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);

    // Evaluate each rule
    for (const rule of sortedRules) {
      try {
        if (rule.condition(context)) {
          matchedRules.push({
            rule,
            reason: rule.description,
          });

          if (rule.action === 'warn') {
            warnings.push(`${rule.name}: ${rule.description}`);
          }
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    }

    // Determine final decision based on priority
    const finalDecision = this.computeFinalDecision(matchedRules);

    return {
      decision: finalDecision,
      matchedRules,
      requiresApproval: finalDecision === 'needs_approval',
      blocked: finalDecision === 'block',
      warnings,
    };
  }

  /**
   * Check if an operation is allowed
   */
  isAllowed(context: PolicyContext): boolean {
    const result = this.evaluate(context);
    return result.decision === 'allow';
  }

  /**
   * Check if an operation needs approval
   */
  needsApproval(context: PolicyContext): boolean {
    const result = this.evaluate(context);
    return result.requiresApproval;
  }

  /**
   * Check if an operation is blocked
   */
  isBlocked(context: PolicyContext): boolean {
    const result = this.evaluate(context);
    return result.blocked;
  }

  /**
   * Get blocking reason
   */
  getBlockReason(context: PolicyContext): string | null {
    const result = this.evaluate(context);
    if (!result.blocked) return null;

    const blockRules = result.matchedRules.filter((m) => m.rule.action === 'block');
    if (blockRules.length === 0) return null;

    return blockRules.map((m) => `${m.rule.name}: ${m.reason}`).join('; ');
  }

  /**
   * Create a new engine with additional rules
   */
  withRules(additionalRules: PolicyRule[]): PolicyEngine {
    const newEngine = new PolicyEngine();
    newEngine.addRules([...Array.from(this.rules.values()), ...additionalRules]);
    return newEngine;
  }

  /**
   * Create child engine for a specific approval mode
   */
  forMode(_mode: 'strict' | 'balanced' | 'fast'): PolicyEngine {
    // Return same engine but context will have the mode
    return this;
  }

  /**
   * Compute final decision from matched rules
   */
  private computeFinalDecision(matchedRules: PolicyResult['matchedRules']): PolicyDecision {
    if (matchedRules.length === 0) {
      return 'allow';
    }

    // Find the highest priority decision
    const actions = matchedRules.map((m) => m.rule.action);

    for (const decision of this.decisionPriority) {
      if (actions.includes(decision)) {
        return decision;
      }
    }

    return 'allow';
  }
}

/**
 * Create a PolicyEngine instance
 */
export function createPolicyEngine(rules: PolicyRule[] = []): PolicyEngine {
  return new PolicyEngine(rules);
}

/**
 * Quick check if command is safe
 */
export function isCommandSafe(command: string): boolean {
  return !COMMAND_DENYLIST.some((pattern) => pattern.test(command));
}

/**
 * Quick check if command is in allowlist
 */
export function isCommandAllowlisted(command: string): boolean {
  return COMMAND_ALLOWLIST.some((pattern) => pattern.test(command));
}
