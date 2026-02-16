/**
 * Workflow states for the Matrix CLI state machine
 */
export type WorkflowState =
  | 'PRD_INTAKE'
  | 'PRD_CLARIFYING'
  | 'PLAN_DRAFTED'
  | 'AWAITING_PLAN_CONFIRMATION'
  | 'IMPLEMENTING'
  | 'QA'
  | 'REVIEW'
  | 'REFACTOR'
  | 'DONE';

/**
 * Agent types in the system
 */
export type AgentType =
  | 'user'
  | 'plan_agent'
  | 'builder_agent'
  | 'qa_agent'
  | 'review_agent'
  | 'refactor_agent'
  | 'system';

/**
 * Approval decision types
 */
export type ApprovalDecision = 'approve' | 'revise' | 'ask' | 'deny';

/**
 * Approval modes
 */
export type ApprovalMode = 'strict' | 'balanced' | 'fast';

/**
 * Redaction levels for event payloads
 */
export type RedactionLevel = 'none' | 'partial' | 'strict';

/**
 * Policy decision types
 */
export type PolicyDecision = 'allow' | 'warn' | 'needs_approval' | 'block';

/**
 * Run configuration
 */
export interface RunConfig {
  runId: string;
  projectId: string;
  workingDirectory: string;
  approvalMode: ApprovalMode;
  modelConfig: ModelConfig;
  mcpServers: MCPServerConfig[];
  workflow: WorkflowConfig;
  security: SecurityConfig;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  planConfirmation: boolean;
  reflexionRetries: number;
  autoLint: boolean;
  autoTest: boolean;
  autoReview: boolean;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  secretPatterns: string[];
  fileDenylist: string[];
  commandDenylist: string[];
  commandAllowlist: string[];
  sandboxEnabled: boolean;
}

/**
 * Tool result type
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool operation class for policy decisions
 */
export type ToolOperation = 'read' | 'write' | 'delete' | 'exec';

/**
 * Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  operation?: ToolOperation;
  requiresApproval?: boolean;
  allowInFastMode?: boolean;
  handler: (...args: unknown[]) => Promise<ToolResult>;
}

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  operation?: ToolOperation;
  userApproved?: boolean;
}

/**
 * Tool execution policy outcome
 */
export interface ToolExecutionPolicyOutcome {
  decision: PolicyDecision;
  reason: string;
}

/**
 * Tool execution result with workflow status
 */
export interface ToolExecutionResult<T = unknown> {
  status: 'success' | 'blocked' | 'needs_input' | 'error';
  toolName: string;
  message: string;
  policy: ToolExecutionPolicyOutcome;
  result?: ToolResult<T>;
}

/**
 * Message types for LLM communication
 */
export interface Message {
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
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Diff information
 */
export interface DiffInfo {
  id: string;
  filePath: string;
  hunks: DiffHunk[];
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'rolled_back';
}

/**
 * Diff hunk
 */
export interface DiffHunk {
  hunkId?: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  status?: 'pending' | 'approved' | 'rejected';
}

/**
 * Checkpoint for state persistence
 */
export interface Checkpoint {
  id: string;
  runId: string;
  timestamp: string;
  state: WorkflowState;
  data: Record<string, unknown>;
}

/**
 * Session information
 */
export interface Session {
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  context: Record<string, unknown>;
}
