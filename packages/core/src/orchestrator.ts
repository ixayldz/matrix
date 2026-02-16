import { v4 as uuidv4 } from 'uuid';
import { StateMachine } from './state-machine.js';
import { EventEmitter, createEventEmitter } from './events/emitter.js';
import { DatabaseManager, createDatabaseManager } from './persistence/database.js';
import { ToolExecutionPipeline, createToolExecutionPipeline } from './tool-execution-pipeline.js';
import type {
  WorkflowState,
  AgentType,
  ApprovalDecision,
  Message,
  ToolDefinition,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolOperation,
} from './types.js';
import type { EventType } from './events/types.js';

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  runId?: string;
  projectId: string;
  workingDirectory: string;
  approvalMode?: 'strict' | 'balanced' | 'fast';
  persistEvents?: boolean;
  /** Maximum reflexion retries (default: 3) */
  maxReflexionRetries?: number;
}

/**
 * Agent context passed to agents
 */
export interface AgentContext {
  runId: string;
  state: WorkflowState;
  messages: Message[];
  tools: Map<string, ToolDefinition>;
  executeTool: (request: ToolExecutionRequest) => Promise<ToolExecutionResult>;
  emit: <T extends EventType>(type: T, payload: unknown) => Promise<void>;
  transition: (state: WorkflowState, reason?: string) => boolean;
}

/**
 * Reflexion result
 */
export interface ReflexionResult {
  success: boolean;
  attempts: number;
  errors: Array<{
    attempt: number;
    error: string;
    analysis?: string;
    fix?: string;
  }>;
  finalResult?: Message;
}

/**
 * Test result for reflexion
 */
export interface TestResult {
  passed: boolean;
  error?: string;
  output?: string;
  failedTests?: string[];
}

/**
 * Agent handler function type
 */
export type AgentHandler = (context: AgentContext) => Promise<Message>;

/**
 * Main orchestrator for Matrix CLI
 */
export class Orchestrator {
  private runId: string;
  private projectId: string;
  private workingDirectory: string;
  private stateMachine: StateMachine;
  private eventEmitter: EventEmitter;
  private database: DatabaseManager;
  private messages: Message[];
  private tools: Map<string, ToolDefinition>;
  private toolPipeline: ToolExecutionPipeline;
  private agents: Map<AgentType, AgentHandler>;
  private isRunning: boolean;
  private maxReflexionRetries: number;
  private reflexionAttempts: number;

  constructor(config: OrchestratorConfig) {
    this.runId = config.runId ?? uuidv4();
    this.projectId = config.projectId;
    this.workingDirectory = config.workingDirectory;
    this.stateMachine = new StateMachine('PRD_INTAKE', config.approvalMode ?? 'balanced');
    this.database = createDatabaseManager();
    this.eventEmitter = createEventEmitter({
      runId: this.runId,
      initialState: this.stateMachine.getState(),
      defaultActor: 'system',
    });
    this.messages = [];
    this.tools = new Map();
    this.toolPipeline = createToolExecutionPipeline();
    this.agents = new Map();
    this.isRunning = false;
    this.maxReflexionRetries = config.maxReflexionRetries ?? 3;
    this.reflexionAttempts = 0;

    // Sync state changes with event emitter
    this.setupStateSync();

    // Persist events if enabled
    if (config.persistEvents !== false) {
      this.setupPersistence();
    }
  }

  /**
   * Get run ID
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get current state
   */
  getState(): WorkflowState {
    return this.stateMachine.getState();
  }

  /**
   * Get messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Get registered tools
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool through the Guardian/Policy/Approval pipeline.
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const tool = this.tools.get(request.toolName);
    if (!tool) {
      return {
        status: 'error',
        toolName: request.toolName,
        message: `Tool ${request.toolName} is not registered.`,
        policy: {
          decision: 'allow',
          reason: 'Tool lookup failed before policy evaluation.',
        },
      };
    }

    const operation = request.operation ?? tool.operation ?? this.inferToolOperation(tool.name);

    return this.toolPipeline.execute(
      tool,
      request.arguments,
      {
        state: this.stateMachine.getState(),
        approvalMode: this.stateMachine.getApprovalMode(),
        workingDirectory: this.workingDirectory,
        userApproved: request.userApproved === true,
        operation,
      },
      this.eventEmitter
    );
  }

  /**
   * Register an agent handler
   */
  registerAgent(type: AgentType, handler: AgentHandler): void {
    this.agents.set(type, handler);
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Create run record
    this.database.createRun(this.projectId, this.workingDirectory, {
      approvalMode: this.stateMachine.getApprovalMode(),
    });

    // Emit start event
    await this.eventEmitter.emit('turn.start', {
      turnNumber: 1,
      input: '',
    });

    // Emit state transition
    await this.eventEmitter.emit('state.transition', {
      from: 'DONE',
      to: 'PRD_INTAKE',
      reason: 'Run started',
    });
  }

  /**
   * Stop the orchestrator
   */
  async stop(reason = 'User requested'): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Update run status
    this.database.updateRunStatus(this.runId, 'cancelled', { reason });

    // Emit end event
    await this.eventEmitter.emit('turn.end', {
      turnNumber: this.messages.length,
      output: reason,
      tokenUsage: { input: 0, output: 0, total: 0 },
    });
  }

  /**
   * Process user input
   */
  async processInput(input: string): Promise<Message | null> {
    if (!this.isRunning) {
      await this.start();
    }

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content: input,
    };
    this.messages.push(userMessage);

    // Emit user input event
    await this.eventEmitter.emit('user.input', {
      input,
      type: 'text',
    });

    // Natural-language and compat-command approval handling is exclusive in plan confirmation state.
    if (this.stateMachine.getState() === 'AWAITING_PLAN_CONFIRMATION') {
      return this.processPlanConfirmationInput(input);
    }

    // Process based on current state
    return this.processState();
  }

  /**
   * Process approval decision
   */
  async processApproval(decision: ApprovalDecision): Promise<boolean> {
    if (this.stateMachine.getState() !== 'AWAITING_PLAN_CONFIRMATION') {
      return false;
    }

    const result = this.stateMachine.processApproval(decision);

    await this.eventEmitter.emit('user.approval', {
      action: 'plan',
      approved: result.approved,
      reason: decision,
      intent: decision,
      confidence: 1,
      decisionSource: 'command',
    });

    if (result.newState) {
      await this.eventEmitter.emit('state.transition', {
        from: 'AWAITING_PLAN_CONFIRMATION',
        to: result.newState,
        reason: `User decision: ${decision}`,
      });

      if (result.approved) {
        await this.runAgent('builder_agent');
        return true;
      }
    }

    return false;
  }

  /**
   * Handle user input while waiting for plan confirmation.
   * Supports both natural language and /plan approve|revise|deny compat commands.
   */
  private async processPlanConfirmationInput(input: string): Promise<Message | null> {
    const explicitDecision = this.parsePlanDecisionCommand(input);

    if (explicitDecision) {
      const applied = await this.processApproval(explicitDecision);
      if (applied) {
        return null;
      }

      if (this.stateMachine.getState() === 'PLAN_DRAFTED') {
        return this.runAgent('plan_agent');
      }

      return this.pushAssistantMessage(
        explicitDecision === 'approve'
          ? 'Plan approval could not be applied. Please confirm with a clear approval.'
          : 'Plan updated. I can revise the plan based on your feedback.'
      );
    }

    const beforeState = this.stateMachine.getState();
    const result = this.stateMachine.processNaturalLanguageApproval(input);

    await this.eventEmitter.emit('user.approval', {
      action: 'plan',
      approved: result.approved,
      reason: `${result.intentResult.intent}:${result.intentResult.confidence.toFixed(2)}:${result.action}`,
      intent: result.intentResult.intent,
      confidence: result.intentResult.confidence,
      decisionSource: 'natural_language',
    });

    if (result.action === 'confirm') {
      return this.pushAssistantMessage(
        'I interpreted this as plan approval. Should I continue? (yes/no)'
      );
    }

    if (result.action === 'no_change') {
      return this.pushAssistantMessage(
        'An explicit approval is required to start implementation. Reply with "approve", "start", or "yes".'
      );
    }

    if (result.newState) {
      await this.eventEmitter.emit('state.transition', {
        from: beforeState,
        to: result.newState,
        reason: `NL intent: ${result.intentResult.intent} (${result.intentResult.confidence.toFixed(2)})`,
      });
    }

    if (result.approved && result.newState === 'IMPLEMENTING') {
      await this.runAgent('builder_agent');
      return null;
    }

    if (result.newState === 'PLAN_DRAFTED') {
      return this.runAgent('plan_agent');
    }

    return null;
  }

  /**
   * Parse explicit compat command: /plan approve|revise|deny
   */
  private parsePlanDecisionCommand(input: string): ApprovalDecision | null {
    const normalized = input.trim().toLowerCase();
    if (!normalized.startsWith('/plan')) {
      return null;
    }

    if (/\bapprove\b/.test(normalized)) {
      return 'approve';
    }
    if (/\brevise\b/.test(normalized)) {
      return 'revise';
    }
    if (/\bdeny\b/.test(normalized)) {
      return 'deny';
    }
    if (/\bask\b/.test(normalized)) {
      return 'ask';
    }

    return null;
  }

  /**
   * Push an assistant message and return it.
   */
  private pushAssistantMessage(content: string): Message {
    const message: Message = {
      role: 'assistant',
      content,
    };
    this.messages.push(message);
    return message;
  }

  /**
   * Process based on current state
   */
  private async processState(): Promise<Message | null> {
    const state = this.stateMachine.getState();

    switch (state) {
      case 'PRD_INTAKE':
      case 'PRD_CLARIFYING':
        return this.runAgent('plan_agent');

      case 'PLAN_DRAFTED':
        this.stateMachine.transition('AWAITING_PLAN_CONFIRMATION', 'Plan drafted');
        await this.eventEmitter.emit('state.transition', {
          from: 'PLAN_DRAFTED',
          to: 'AWAITING_PLAN_CONFIRMATION',
          reason: 'Plan drafted, awaiting approval',
        });
        return null;

      case 'AWAITING_PLAN_CONFIRMATION':
        return null;

      case 'IMPLEMENTING':
        return this.runAgent('builder_agent');

      case 'QA':
        // Use reflexion loop for QA
        const reflexionResult = await this.runQAWithReflexion();
        if (reflexionResult.success && reflexionResult.finalResult) {
          return reflexionResult.finalResult;
        }
        // If reflexion failed, transition to error state or retry
        return null;

      case 'REVIEW':
        return this.runAgent('review_agent');

      case 'REFACTOR':
        return this.runAgent('refactor_agent');

      case 'DONE':
        return null;

      default:
        return null;
    }
  }

  /**
   * Run a specific agent
   */
  private async runAgent(agentType: AgentType): Promise<Message | null> {
    const handler = this.agents.get(agentType);
    if (!handler) {
      console.warn(`No handler registered for agent: ${agentType}`);
      return null;
    }

    // Emit agent start
    await this.eventEmitter.emit('agent.start', {
      agentType,
      task: this.getCurrentTask(),
    });

    try {
      const context: AgentContext = {
        runId: this.runId,
        state: this.stateMachine.getState(),
        messages: this.messages,
        tools: this.tools,
        executeTool: (request) => this.executeTool(request),
        emit: async (type, payload) => {
          await this.eventEmitter.emit(type, payload as never, { actor: agentType });
        },
        transition: (state, reason) => {
          const from = this.stateMachine.getState();
          const success = this.stateMachine.transition(state, reason);
          if (success) {
            const transitionPayload: { from: WorkflowState; to: WorkflowState; reason?: string } = {
              from,
              to: state,
            };
            if (reason !== undefined) {
              transitionPayload.reason = reason;
            }
            this.eventEmitter.emit('state.transition', transitionPayload);
          }
          return success;
        },
      };

      const response = await handler(context);

      // Add response to messages
      this.messages.push(response);

      // Emit agent stop
      await this.eventEmitter.emit('agent.stop', {
        agentType,
        result: 'success',
      });

      return response;
    } catch (error) {
      await this.eventEmitter.emit('agent.stop', {
        agentType,
        result: 'failure',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      const errorPayload: {
        code: string;
        message: string;
        recoverable: boolean;
        stack?: string;
      } = {
        code: 'AGENT_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        recoverable: true,
      };
      if (error instanceof Error && error.stack !== undefined) {
        errorPayload.stack = error.stack;
      }

      await this.eventEmitter.emit('error', errorPayload);

      return null;
    }
  }

  /**
   * Get current task description
   */
  private getCurrentTask(): string {
    const state = this.stateMachine.getState();
    switch (state) {
      case 'PRD_INTAKE':
        return 'Processing PRD';
      case 'PRD_CLARIFYING':
        return 'Asking clarifying questions';
      case 'PLAN_DRAFTED':
        return 'Drafting plan';
      case 'AWAITING_PLAN_CONFIRMATION':
        return 'Awaiting plan confirmation';
      case 'IMPLEMENTING':
        return 'Implementing changes';
      case 'QA':
        return 'Running tests';
      case 'REVIEW':
        return 'Reviewing code';
      case 'REFACTOR':
        return 'Refactoring code';
      case 'DONE':
        return 'Completed';
      default:
        return 'Unknown task';
    }
  }

  /**
   * Transition to next state
   */
  async transitionTo(state: WorkflowState, reason?: string): Promise<boolean> {
    const from = this.stateMachine.getState();
    const success = this.stateMachine.transition(state, reason);

    if (success) {
      const transitionPayload: { from: WorkflowState; to: WorkflowState; reason?: string } = {
        from,
        to: state,
      };
      if (reason !== undefined) {
        transitionPayload.reason = reason;
      }
      await this.eventEmitter.emit('state.transition', transitionPayload);
    }

    return success;
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(description?: string): Promise<string> {
    const checkpoint = this.database.saveCheckpoint(
      this.runId,
      this.stateMachine.getState(),
      {
        messages: this.messages,
        toolCount: this.tools.size,
      },
      description
    );

    await this.eventEmitter.emit('checkpoint.saved', {
      checkpointId: checkpoint.id,
      state: this.stateMachine.getState() as WorkflowState,
    });

    return checkpoint.id;
  }

  /**
   * Restore from checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoints = this.database.listCheckpoints(this.runId);
    const checkpoint = checkpoints.find((c) => c.id === checkpointId);

    if (!checkpoint) {
      return false;
    }

    // Restore state
    this.stateMachine.setState(checkpoint.state as WorkflowState);

    // Restore data
    if (checkpoint.data.messages) {
      this.messages = checkpoint.data.messages as Message[];
    }

    await this.eventEmitter.emit('checkpoint.restored', {
      checkpointId,
      state: checkpoint.state as WorkflowState,
    });

    return true;
  }

  /**
   * Get event emitter (for external listeners)
   */
  getEventEmitter(): EventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get database manager (for external access)
   */
  getDatabase(): DatabaseManager {
    return this.database;
  }

  /**
   * Get state machine (for external access)
   */
  getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  private inferToolOperation(toolName: string): ToolOperation {
    const normalized = toolName.toLowerCase();

    if (normalized.includes('read') || normalized.includes('list') || normalized.includes('search')) {
      return 'read';
    }

    if (normalized.includes('delete') || normalized.includes('remove')) {
      return 'delete';
    }

    if (
      normalized.includes('exec') ||
      normalized.includes('run') ||
      normalized.includes('test') ||
      normalized.includes('lint')
    ) {
      return 'exec';
    }

    if (
      normalized.includes('write') ||
      normalized.includes('patch') ||
      normalized.includes('apply') ||
      normalized.includes('format')
    ) {
      return 'write';
    }

    return 'read';
  }

  /**
   * Setup state synchronization
   */
  private setupStateSync(): void {
    // Listen for state transitions and update event emitter
    this.eventEmitter.on('state.transition', async (event) => {
      const payload = event.payload as { to: WorkflowState };
      this.eventEmitter.setState(payload.to);
    });
  }

  /**
   * Setup event persistence
   */
  private setupPersistence(): void {
    this.eventEmitter.onAll((event) => {
      try {
        this.database.saveEvent(event);
      } catch (error) {
        console.error('Failed to persist event:', error);
      }
    });
  }

  // ==================== REFLEXION LOOP ====================

  /**
   * Run QA with reflexion loop
   *
   * Implements PRD Section 5.4 Reflexion Loop:
   * - Test fails -> error analysis
   * - Feedback to Builder -> fix
   * - Retry test (max 3)
   */
  async runQAWithReflexion(): Promise<ReflexionResult> {
    const result: ReflexionResult = {
      success: false,
      attempts: 0,
      errors: [],
    };

    this.reflexionAttempts = 0;

    while (this.reflexionAttempts < this.maxReflexionRetries) {
      this.reflexionAttempts++;
      result.attempts = this.reflexionAttempts;

      // Emit reflexion attempt event
      await this.eventEmitter.emit('test.run', {
        framework: 'reflexion',
        testPattern: `attempt-${this.reflexionAttempts}`,
        fileCount: 0,
      });

      // Run QA agent
      const qaResult = await this.runAgent('qa_agent');

      if (!qaResult) {
        result.errors.push({
          attempt: this.reflexionAttempts,
          error: 'QA agent returned no result',
        });
        continue;
      }

      // Parse test result from QA response
      const testResult = this.parseTestResult(qaResult);

      if (testResult.passed) {
        // Tests passed!
        result.success = true;
        result.finalResult = qaResult;

        await this.eventEmitter.emit('test.result', {
          framework: 'reflexion',
          passed: 1,
          failed: 0,
          skipped: 0,
          duration: 0,
        });

        // Transition to REVIEW
        await this.transitionTo('REVIEW', 'Tests passed');
        return result;
      }

      // Tests failed - analyze and retry
      result.errors.push({
        attempt: this.reflexionAttempts,
        error: testResult.error || 'Tests failed',
        analysis: this.analyzeTestFailure(testResult),
      });

      // Emit failure event
      await this.eventEmitter.emit('test.result', {
        framework: 'reflexion',
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: 0,
      });

      // If not last attempt, run reflexion cycle
      if (this.reflexionAttempts < this.maxReflexionRetries) {
        await this.runReflexionCycle(testResult);
      }
    }

    // Max retries exceeded
    await this.eventEmitter.emit('error', {
      code: 'REFLEXION_MAX_RETRIES',
      message: `Maximum reflexion retries (${this.maxReflexionRetries}) exceeded`,
      recoverable: false,
    });

    return result;
  }

  /**
   * Run a single reflexion cycle
   */
  private async runReflexionCycle(testResult: TestResult): Promise<void> {
    // Emit reflexion event
    await this.eventEmitter.emit('agent.start', {
      agentType: 'builder_agent',
      task: 'reflexion_fix',
    });

    // Create feedback message for Builder
    const feedbackMessage: Message = {
      role: 'system',
      content: this.createReflexionFeedback(testResult),
    };

    // Add feedback to messages
    this.messages.push(feedbackMessage);

    // Run Builder agent to fix the issue
    const fixResult = await this.runAgent('builder_agent');

    if (fixResult) {
      await this.eventEmitter.emit('agent.stop', {
        agentType: 'builder_agent',
        result: 'success',
        reason: `Reflexion fix attempt ${this.reflexionAttempts}`,
      });
    } else {
      await this.eventEmitter.emit('agent.stop', {
        agentType: 'builder_agent',
        result: 'failure',
        reason: 'Failed to generate fix',
      });
    }
  }

  /**
   * Parse test result from QA agent response
   */
  private parseTestResult(message: Message): TestResult {
    const content = message.content;

    // Check for explicit test failure markers
    const failedMatch = content.match(/tests?\s*(failed|error|FAIL)/i);
    const passedMatch = content.match(/tests?\s*(passed|success|PASS)/i);

    // Extract failed tests
    const failedTests: string[] = [];
    const failedTestMatches = content.matchAll(/(?:FAIL|ERROR|✗|✖)\s*(?:\]?\s*)?([^\n]+)/gi);
    for (const match of failedTestMatches) {
      if (match[1]) {
        failedTests.push(match[1].trim());
      }
    }

    // Determine overall result
    const passed = failedMatch === null && (passedMatch !== null || failedTests.length === 0);

    // Extract error message
    let error: string | undefined;
    const errorMatch = content.match(/(?:Error|FAIL|AssertionError)[::\s]+([^\n]+)/i);
    if (errorMatch) {
      error = errorMatch[1]?.trim();
    }

    const result: TestResult = {
      passed,
      output: content,
      failedTests,
    };
    if (error !== undefined) {
      result.error = error;
    }

    return result;
  }

  /**
   * Analyze test failure for reflexion
   */
  private analyzeTestFailure(testResult: TestResult): string {
    const analysis: string[] = [];

    if (testResult.failedTests && testResult.failedTests.length > 0) {
      analysis.push(`Failed tests: ${testResult.failedTests.join(', ')}`);
    }

    if (testResult.error) {
      analysis.push(`Error: ${testResult.error}`);

      // Common error patterns
      if (testResult.error.includes('TypeError')) {
        analysis.push('Type error detected - check for undefined/null values or incorrect types');
      } else if (testResult.error.includes('AssertionError')) {
        analysis.push('Assertion failed - check expected vs actual values');
      } else if (testResult.error.includes('SyntaxError')) {
        analysis.push('Syntax error - check for typos or missing brackets');
      } else if (testResult.error.includes('ENOENT')) {
        analysis.push('File not found - check file paths and existence');
      }
    }

    return analysis.join('\n');
  }

  /**
   * Create feedback message for reflexion cycle
   */
  private createReflexionFeedback(testResult: TestResult): string {
    const parts = [
      '## Test Failure Analysis (Reflexion Cycle)',
      '',
      `Attempt: ${this.reflexionAttempts}/${this.maxReflexionRetries}`,
      '',
    ];

    if (testResult.error) {
      parts.push('### Error:');
      parts.push('```');
      parts.push(testResult.error);
      parts.push('```');
      parts.push('');
    }

    if (testResult.failedTests && testResult.failedTests.length > 0) {
      parts.push('### Failed Tests:');
      for (const test of testResult.failedTests) {
        parts.push(`- ${test}`);
      }
      parts.push('');
    }

    parts.push('### Analysis:');
    parts.push(this.analyzeTestFailure(testResult));
    parts.push('');

    parts.push('### Instructions:');
    parts.push('1. Analyze the test failure above');
    parts.push('2. Identify the root cause');
    parts.push('3. Fix the code to make the tests pass');
    parts.push('4. Ensure the fix does not break other functionality');
    parts.push('');
    parts.push('Please fix the failing tests and ensure all tests pass.');

    return parts.join('\n');
  }

  /**
   * Get reflexion statistics
   */
  getReflexionStats(): {
    attempts: number;
    maxAttempts: number;
    remainingAttempts: number;
  } {
    return {
      attempts: this.reflexionAttempts,
      maxAttempts: this.maxReflexionRetries,
      remainingAttempts: Math.max(0, this.maxReflexionRetries - this.reflexionAttempts),
    };
  }

  /**
   * Reset reflexion counter
   */
  resetReflexionCounter(): void {
    this.reflexionAttempts = 0;
  }
}

/**
 * Create an orchestrator instance
 */
export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return new Orchestrator(config);
}
