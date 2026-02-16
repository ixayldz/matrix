import type { EventEmitter } from './events/emitter.js';
import type { ToolCallPayload, ToolResultPayload } from './events/types.js';
import type {
  ApprovalMode,
  PolicyDecision,
  ToolDefinition,
  ToolExecutionResult,
  ToolOperation,
  WorkflowState,
} from './types.js';

const WRITE_BLOCKED_STATES: Set<WorkflowState> = new Set([
  'PRD_INTAKE',
  'PRD_CLARIFYING',
  'PLAN_DRAFTED',
  'AWAITING_PLAN_CONFIRMATION',
]);

const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\b/i,
  /\bcurl\s+.+\|\s*(bash|sh)\b/i,
  /\bwget\s+.+\|\s*(bash|sh)\b/i,
];

const FAST_ALLOWLIST_PATTERNS: RegExp[] = [
  /^\s*(npm|pnpm|yarn)\s+(test|run\s+test)\b/i,
  /^\s*(git)\s+(status|diff|log)\b/i,
  /^\s*(ls|dir|pwd|echo)\b/i,
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /sk-ant-[a-zA-Z0-9-]{20,}/,
  /api[_-]?key\b/i,
  /secret\b/i,
  /token\b/i,
  /bearer\s+[a-zA-Z0-9._-]+/i,
  /password\b/i,
];

interface PipelineContext {
  state: WorkflowState;
  approvalMode: ApprovalMode;
  workingDirectory: string;
  userApproved: boolean;
  operation: ToolOperation;
}

export class ToolExecutionPipeline {
  private detectSensitive(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
    }

    if (Array.isArray(value)) {
      return value.some((item) => this.detectSensitive(item));
    }

    if (typeof value === 'object') {
      return Object.entries(value).some(([key, nested]) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('password') ||
          lowerKey.includes('key')
        ) {
          return true;
        }
        return this.detectSensitive(nested);
      });
    }

    return false;
  }

  private extractCommand(args: Record<string, unknown>): string {
    const command = args.command;
    if (typeof command === 'string') {
      return command;
    }
    const cmd = args.cmd;
    if (typeof cmd === 'string') {
      return cmd;
    }
    return '';
  }

  private isFastAllowlisted(command: string): boolean {
    return FAST_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(command));
  }

  private evaluatePolicy(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    context: PipelineContext
  ): { decision: PolicyDecision; reason: string } {
    const command = this.extractCommand(args);

    if (context.operation !== 'read' && WRITE_BLOCKED_STATES.has(context.state)) {
      return {
        decision: 'block',
        reason: `State ${context.state} blocks ${context.operation} operations until planning is confirmed.`,
      };
    }

    if (context.operation === 'exec' && DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      return {
        decision: 'block',
        reason: 'Command matches dangerous execution patterns.',
      };
    }

    if (this.detectSensitive(args) && context.operation !== 'read') {
      return {
        decision: 'block',
        reason: 'Guardian gate detected sensitive data in tool payload.',
      };
    }

    if (
      context.approvalMode === 'strict' &&
      context.operation !== 'read' &&
      !context.userApproved
    ) {
      return {
        decision: 'needs_approval',
        reason: 'Strict mode requires explicit approval for non-read operations.',
      };
    }

    if (
      context.approvalMode === 'balanced' &&
      ['write', 'delete', 'exec'].includes(context.operation) &&
      !context.userApproved
    ) {
      return {
        decision: 'needs_approval',
        reason: 'Balanced mode requires approval for write/delete/exec operations.',
      };
    }

    if (
      context.approvalMode === 'fast' &&
      context.operation === 'exec' &&
      !tool.allowInFastMode &&
      !this.isFastAllowlisted(command) &&
      !context.userApproved
    ) {
      return {
        decision: 'needs_approval',
        reason: 'Fast mode only auto-approves allowlisted execution commands.',
      };
    }

    if (tool.requiresApproval === true && !context.userApproved) {
      return {
        decision: 'needs_approval',
        reason: `Tool ${tool.name} requires explicit user approval.`,
      };
    }

    return {
      decision: 'allow',
      reason: 'Policy checks passed.',
    };
  }

  async execute<T>(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    context: PipelineContext,
    eventEmitter: EventEmitter
  ): Promise<ToolExecutionResult<T>> {
    const policy = this.evaluatePolicy(tool, args, context);

    const toolCallPayload: ToolCallPayload = {
      toolName: tool.name,
      arguments: args,
      requiresApproval: policy.decision === 'needs_approval' || tool.requiresApproval === true,
    };
    await eventEmitter.emit('tool.call', toolCallPayload);

    if (policy.decision === 'block') {
      await eventEmitter.emit('policy.block', {
        rule: 'tool_policy',
        message: policy.reason,
        action: `${context.operation}:${tool.name}`,
      });

      const blockedToolResult: ToolResultPayload = {
        toolName: tool.name,
        success: false,
        error: policy.reason,
        durationMs: 0,
      };
      await eventEmitter.emit('tool.result', blockedToolResult);

      return {
        status: 'blocked',
        toolName: tool.name,
        message: policy.reason,
        policy,
      };
    }

    if (policy.decision === 'needs_approval') {
      const approvalToolResult: ToolResultPayload = {
        toolName: tool.name,
        success: false,
        error: policy.reason,
        durationMs: 0,
      };
      await eventEmitter.emit('tool.result', approvalToolResult);

      return {
        status: 'needs_input',
        toolName: tool.name,
        message: policy.reason,
        policy,
      };
    }

    const startedAt = Date.now();
    try {
      const result = await tool.handler(args);
      const durationMs = Date.now() - startedAt;

      const toolResultPayload: ToolResultPayload = {
        toolName: tool.name,
        success: result.success,
        durationMs,
      };
      if (result.success) {
        toolResultPayload.result = result.data;
      } else if (result.error) {
        toolResultPayload.error = result.error;
      }
      await eventEmitter.emit('tool.result', toolResultPayload);

      return {
        status: result.success ? 'success' : 'error',
        toolName: tool.name,
        message: result.success
          ? `Tool ${tool.name} executed successfully.`
          : (result.error ?? `Tool ${tool.name} execution failed.`),
        policy,
        result: result as never,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : 'Tool execution failed.';

      await eventEmitter.emit('tool.result', {
        toolName: tool.name,
        success: false,
        error: message,
        durationMs,
      });

      return {
        status: 'error',
        toolName: tool.name,
        message,
        policy,
      };
    }
  }
}

export function createToolExecutionPipeline(): ToolExecutionPipeline {
  return new ToolExecutionPipeline();
}
