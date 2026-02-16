import type { ApprovalDecision, Message, WorkflowState } from './types.js';
import type { Orchestrator } from './orchestrator.js';

export type WorkflowCommandStatus = 'success' | 'blocked' | 'needs_input' | 'error';

export interface PlanApprovalInsight {
  intent: ApprovalDecision;
  confidence: number;
  action: 'direct_apply' | 'confirm' | 'no_change';
  reasoning?: string;
}

export interface WorkflowCommandResult {
  status: WorkflowCommandStatus;
  state: WorkflowState;
  message: string;
  response?: Message | null;
  approval?: PlanApprovalInsight;
}

const BUILD_COMMAND = /^\/build\b/i;
const PLAN_DECISION_COMMAND = /^\/plan\s+(approve|revise|deny|ask)\b/i;

/**
 * High-level workflow facade used by CLI/TUI layers.
 * Maps core orchestrator behavior to PRD command contracts.
 */
export class WorkflowFacade {
  private orchestrator: Orchestrator;

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
  }

  getState(): WorkflowState {
    return this.orchestrator.getState();
  }

  getMessages(): Message[] {
    return this.orchestrator.getMessages();
  }

  getRunId(): string {
    return this.orchestrator.getRunId();
  }

  async processUserInput(input: string): Promise<WorkflowCommandResult> {
    const trimmedInput = input.trim();
    const currentState = this.orchestrator.getState();

    if (currentState === 'AWAITING_PLAN_CONFIRMATION' && BUILD_COMMAND.test(trimmedInput)) {
      await this.emitPlanLockBlock('build', 'Plan approval is required before implementation starts.');
      return {
        status: 'needs_input',
        state: this.orchestrator.getState(),
        message: 'Plan approval is required before implementation starts.',
      };
    }

    const approvalInsight = this.getApprovalInsight(trimmedInput);

    try {
      const response = await this.orchestrator.processInput(input);
      const state = this.orchestrator.getState();

      const status = this.resolveStatus(state, approvalInsight);
      return {
        status,
        state,
        response,
        message: response?.content ?? this.defaultMessageForState(state),
        ...(approvalInsight ? { approval: approvalInsight } : {}),
      };
    } catch (error) {
      return {
        status: 'error',
        state: this.orchestrator.getState(),
        message: error instanceof Error ? error.message : 'Failed to process workflow input',
      };
    }
  }

  async startPlan(initialInput?: string): Promise<WorkflowCommandResult> {
    if (initialInput && initialInput.trim().length > 0) {
      return this.processUserInput(initialInput);
    }

    const state = this.orchestrator.getState();
    if (!['PRD_INTAKE', 'PRD_CLARIFYING', 'PLAN_DRAFTED', 'DONE'].includes(state)) {
      return {
        status: 'blocked',
        state,
        message: `Cannot start planning from state: ${state}`,
      };
    }

    if (state === 'DONE') {
      await this.orchestrator.transitionTo('PRD_INTAKE', 'Starting a new planning cycle');
    }

    return {
      status: 'success',
      state: this.orchestrator.getState(),
      message: 'Plan agent is active. Describe your requirements to draft a plan.',
    };
  }

  async submitPlanDecision(input: string): Promise<WorkflowCommandResult> {
    if (this.orchestrator.getState() !== 'AWAITING_PLAN_CONFIRMATION') {
      return {
        status: 'blocked',
        state: this.orchestrator.getState(),
        message: 'Plan decision is only allowed while awaiting plan confirmation.',
      };
    }
    return this.processUserInput(input);
  }

  async runBuild(): Promise<WorkflowCommandResult> {
    const state = this.orchestrator.getState();

    if (state === 'AWAITING_PLAN_CONFIRMATION') {
      await this.emitPlanLockBlock('build', 'Plan approval is required before implementation starts.');
      return {
        status: 'needs_input',
        state,
        message: 'Plan approval is required before implementation starts.',
      };
    }

    if (state !== 'IMPLEMENTING') {
      const transitioned = await this.orchestrator.transitionTo('IMPLEMENTING', 'Build command requested');
      if (!transitioned && this.orchestrator.getState() !== 'IMPLEMENTING') {
        return {
          status: 'blocked',
          state: this.orchestrator.getState(),
          message: `Cannot enter IMPLEMENTING from state: ${state}`,
        };
      }
    }

    return this.processUserInput('/build');
  }

  async runQA(): Promise<WorkflowCommandResult> {
    const state = this.orchestrator.getState();
    if (!['IMPLEMENTING', 'QA'].includes(state)) {
      return {
        status: 'blocked',
        state,
        message: `Cannot run QA from state: ${state}`,
      };
    }

    if (state !== 'QA') {
      await this.orchestrator.transitionTo('QA', 'QA command requested');
    }

    const reflexionResult = await this.orchestrator.runQAWithReflexion();
    const nextState = this.orchestrator.getState();
    return {
      status: reflexionResult.success ? 'success' : 'error',
      state: nextState,
      response: reflexionResult.finalResult ?? null,
      message: reflexionResult.success
        ? (reflexionResult.finalResult?.content ?? 'QA finished successfully.')
        : `QA failed after ${reflexionResult.attempts} attempts.`,
    };
  }

  async runReview(): Promise<WorkflowCommandResult> {
    const state = this.orchestrator.getState();
    if (!['QA', 'REVIEW'].includes(state)) {
      return {
        status: 'blocked',
        state,
        message: `Cannot run review from state: ${state}`,
      };
    }

    if (state !== 'REVIEW') {
      await this.orchestrator.transitionTo('REVIEW', 'Review command requested');
    }

    return this.processUserInput('/review');
  }

  async runRefactor(): Promise<WorkflowCommandResult> {
    const state = this.orchestrator.getState();
    if (!['REVIEW', 'REFACTOR'].includes(state)) {
      return {
        status: 'blocked',
        state,
        message: `Cannot run refactor from state: ${state}`,
      };
    }

    if (state !== 'REFACTOR') {
      await this.orchestrator.transitionTo('REFACTOR', 'Refactor command requested');
    }

    return this.processUserInput('/refactor');
  }

  async stop(reason = 'User requested'): Promise<WorkflowCommandResult> {
    await this.orchestrator.stop(reason);
    return {
      status: 'success',
      state: this.orchestrator.getState(),
      message: reason,
    };
  }

  private async emitPlanLockBlock(action: string, message: string): Promise<void> {
    await this.orchestrator.getEventEmitter().emit('policy.block', {
      rule: 'plan_lock',
      message,
      action,
    });
  }

  private getApprovalInsight(input: string): PlanApprovalInsight | undefined {
    if (this.orchestrator.getState() !== 'AWAITING_PLAN_CONFIRMATION') {
      return undefined;
    }

    if (PLAN_DECISION_COMMAND.test(input)) {
      const intentMatch = input.trim().toLowerCase().match(PLAN_DECISION_COMMAND);
      const intent = (intentMatch?.[1] ?? 'ask') as ApprovalDecision;
      return {
        intent,
        confidence: 1,
        action: 'direct_apply',
        reasoning: 'Explicit /plan decision command',
      };
    }

    const classifier = this.orchestrator.getStateMachine().getIntentClassifier();
    const classified = classifier.classify(input);
    const options = classifier.getOptions();

    let action: 'direct_apply' | 'confirm' | 'no_change' = 'no_change';
    if (classified.confidence >= options.approveThreshold) {
      action = 'direct_apply';
    } else if (classified.confidence >= options.confirmThreshold) {
      action = 'confirm';
    }

    const insight: PlanApprovalInsight = {
      intent: classified.intent,
      confidence: classified.confidence,
      action,
    };
    if (classified.reasoning !== undefined) {
      insight.reasoning = classified.reasoning;
    }
    return insight;
  }

  private resolveStatus(
    state: WorkflowState,
    approvalInsight?: PlanApprovalInsight
  ): WorkflowCommandStatus {
    if (!approvalInsight || state !== 'AWAITING_PLAN_CONFIRMATION') {
      return 'success';
    }

    if (approvalInsight.action !== 'direct_apply') {
      if (approvalInsight.intent === 'ask' && approvalInsight.confidence >= 0.85) {
        return 'success';
      }
      return 'needs_input';
    }

    return 'success';
  }

  private defaultMessageForState(state: WorkflowState): string {
    switch (state) {
      case 'PRD_INTAKE':
      case 'PRD_CLARIFYING':
        return 'Planning in progress.';
      case 'PLAN_DRAFTED':
        return 'Plan drafted.';
      case 'AWAITING_PLAN_CONFIRMATION':
        return 'Awaiting explicit plan confirmation.';
      case 'IMPLEMENTING':
        return 'Implementation in progress.';
      case 'QA':
        return 'QA cycle in progress.';
      case 'REVIEW':
        return 'Review cycle in progress.';
      case 'REFACTOR':
        return 'Refactor cycle in progress.';
      case 'DONE':
        return 'Workflow completed.';
      default:
        return 'Workflow updated.';
    }
  }
}

export function createWorkflowFacade(orchestrator: Orchestrator): WorkflowFacade {
  return new WorkflowFacade(orchestrator);
}
