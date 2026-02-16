import type { WorkflowState, AgentType, RedactionLevel, ApprovalDecision } from '../types.js';

/**
 * Event envelope version
 */
export const EVENT_VERSION = 'v1' as const;

/**
 * Base event envelope structure
 */
export interface EventEnvelope<T = unknown> {
  eventVersion: typeof EVENT_VERSION;
  runId: string;
  eventId: string;
  timestamp: string;
  state: WorkflowState;
  actor: AgentType;
  type: EventType;
  correlationId: string;
  payload: T;
  redactionLevel: RedactionLevel;
}

/**
 * All event types - PRD Section 6.3
 */
export type EventType =
  | 'turn.start'
  | 'turn.end'
  | 'agent.start'
  | 'agent.stop'
  | 'model.call'
  | 'model.result'
  | 'tool.call'
  | 'tool.result'
  | 'diff.proposed'
  | 'diff.approved'
  | 'diff.rejected'
  | 'diff.applied'
  | 'diff.rolled_back'
  | 'diff.hunk.approved'
  | 'diff.hunk.rejected'
  | 'policy.warn'
  | 'policy.block'
  | 'test.run'
  | 'test.result'
  | 'checkpoint.saved'
  | 'checkpoint.restored'
  | 'state.transition'
  | 'error'
  | 'user.input'
  | 'user.approval';

/**
 * Turn start event payload
 */
export interface TurnStartPayload {
  turnNumber: number;
  input: string;
}

/**
 * Turn end event payload
 */
export interface TurnEndPayload {
  turnNumber: number;
  output: string;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Agent start event payload
 */
export interface AgentStartPayload {
  agentType: AgentType;
  task: string;
}

/**
 * Agent stop event payload
 */
export interface AgentStopPayload {
  agentType: AgentType;
  result: 'success' | 'failure' | 'cancelled';
  reason?: string;
}

/**
 * Model call event payload
 */
export interface ModelCallPayload {
  provider: string;
  model: string;
  messageCount: number;
  toolsAvailable: string[];
}

/**
 * Model result event payload
 */
export interface ModelResultPayload {
  provider: string;
  model: string;
  response: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  latencyMs: number;
}

/**
 * Tool call event payload
 */
export interface ToolCallPayload {
  toolName: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
}

/**
 * Tool result event payload
 */
export interface ToolResultPayload {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Diff proposed event payload
 */
export interface DiffProposedPayload {
  diffId: string;
  filePath: string;
  hunks: number;
  additions: number;
  deletions: number;
}

/**
 * Diff approved event payload
 */
export interface DiffApprovedPayload {
  diffId: string;
  approvedBy: 'user' | 'auto';
}

/**
 * Diff rejected event payload
 */
export interface DiffRejectedPayload {
  diffId: string;
  rejectedBy: 'user' | 'policy';
  reason?: string;
}

/**
 * Diff applied event payload
 */
export interface DiffAppliedPayload {
  diffId: string;
  filePath: string;
  checksum: string;
  backupPath?: string;
}

/**
 * Diff rolled back event payload
 */
export interface DiffRolledBackPayload {
  diffId: string;
  filePath: string;
  reason: string;
}

/**
 * Diff hunk approved event payload - PRD Section 6.3
 */
export interface DiffHunkApprovedPayload {
  diffId: string;
  hunkId: string;
  hunkIndex: number;
  filePath: string;
  approvedBy: 'user' | 'auto';
}

/**
 * Diff hunk rejected event payload - PRD Section 6.3
 */
export interface DiffHunkRejectedPayload {
  diffId: string;
  hunkId: string;
  hunkIndex: number;
  filePath: string;
  rejectedBy: 'user' | 'policy';
  reason?: string;
}

/**
 * Policy warn event payload
 */
export interface PolicyWarnPayload {
  rule: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Policy block event payload
 */
export interface PolicyBlockPayload {
  rule: string;
  message: string;
  action: string;
  context?: Record<string, unknown>;
}

/**
 * Test run event payload
 */
export interface TestRunPayload {
  framework: string;
  testPattern?: string;
  fileCount: number;
}

/**
 * Test result event payload
 */
export interface TestResultPayload {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: number;
}

/**
 * Checkpoint saved event payload
 */
export interface CheckpointSavedPayload {
  checkpointId: string;
  state: WorkflowState;
}

/**
 * Checkpoint restored event payload
 */
export interface CheckpointRestoredPayload {
  checkpointId: string;
  state: WorkflowState;
}

/**
 * State transition event payload
 */
export interface StateTransitionPayload {
  from: WorkflowState;
  to: WorkflowState;
  reason?: string;
}

/**
 * Error event payload
 */
export interface ErrorPayload {
  code: string;
  message: string;
  stack?: string;
  recoverable: boolean;
}

/**
 * User input event payload
 */
export interface UserInputPayload {
  input: string;
  type: 'text' | 'command' | 'approval';
}

/**
 * User approval event payload
 */
export interface UserApprovalPayload {
  action: string;
  approved: boolean;
  reason?: string;
  intent?: ApprovalDecision;
  confidence?: number;
  decisionSource?: 'natural_language' | 'command';
}

/**
 * Event payload union type
 */
export type EventPayload =
  | TurnStartPayload
  | TurnEndPayload
  | AgentStartPayload
  | AgentStopPayload
  | ModelCallPayload
  | ModelResultPayload
  | ToolCallPayload
  | ToolResultPayload
  | DiffProposedPayload
  | DiffApprovedPayload
  | DiffRejectedPayload
  | DiffAppliedPayload
  | DiffRolledBackPayload
  | DiffHunkApprovedPayload
  | DiffHunkRejectedPayload
  | PolicyWarnPayload
  | PolicyBlockPayload
  | TestRunPayload
  | TestResultPayload
  | CheckpointSavedPayload
  | CheckpointRestoredPayload
  | StateTransitionPayload
  | ErrorPayload
  | UserInputPayload
  | UserApprovalPayload;

/**
 * Event type to payload mapping
 */
export interface EventTypeMap {
  'turn.start': TurnStartPayload;
  'turn.end': TurnEndPayload;
  'agent.start': AgentStartPayload;
  'agent.stop': AgentStopPayload;
  'model.call': ModelCallPayload;
  'model.result': ModelResultPayload;
  'tool.call': ToolCallPayload;
  'tool.result': ToolResultPayload;
  'diff.proposed': DiffProposedPayload;
  'diff.approved': DiffApprovedPayload;
  'diff.rejected': DiffRejectedPayload;
  'diff.applied': DiffAppliedPayload;
  'diff.rolled_back': DiffRolledBackPayload;
  'diff.hunk.approved': DiffHunkApprovedPayload;
  'diff.hunk.rejected': DiffHunkRejectedPayload;
  'policy.warn': PolicyWarnPayload;
  'policy.block': PolicyBlockPayload;
  'test.run': TestRunPayload;
  'test.result': TestResultPayload;
  'checkpoint.saved': CheckpointSavedPayload;
  'checkpoint.restored': CheckpointRestoredPayload;
  'state.transition': StateTransitionPayload;
  error: ErrorPayload;
  'user.input': UserInputPayload;
  'user.approval': UserApprovalPayload;
}
