import type { WorkflowState, ApprovalDecision, ApprovalMode } from './types.js';
import { IntentClassifier, type IntentResult, type IntentClassifierOptions } from './intent-classifier.js';

/**
 * State transition rules
 */
const VALID_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  PRD_INTAKE: ['PRD_CLARIFYING', 'PLAN_DRAFTED'],
  PRD_CLARIFYING: ['PLAN_DRAFTED', 'PRD_CLARIFYING'],
  PLAN_DRAFTED: ['AWAITING_PLAN_CONFIRMATION'],
  AWAITING_PLAN_CONFIRMATION: ['IMPLEMENTING', 'PLAN_DRAFTED', 'PRD_CLARIFYING'],
  IMPLEMENTING: ['QA', 'IMPLEMENTING'],
  QA: ['REVIEW', 'IMPLEMENTING'],
  REVIEW: ['REFACTOR', 'DONE', 'IMPLEMENTING'],
  REFACTOR: ['DONE', 'IMPLEMENTING'],
  DONE: ['PRD_INTAKE'],
};

/**
 * States where write/exec operations are blocked
 */
const WRITE_BLOCKED_STATES: Set<WorkflowState> = new Set([
  'PRD_INTAKE',
  'PRD_CLARIFYING',
  'PLAN_DRAFTED',
  'AWAITING_PLAN_CONFIRMATION',
]);

/**
 * States where only read operations are allowed
 */
const READ_ONLY_STATES: Set<WorkflowState> = new Set(['REVIEW', 'DONE']);

/**
 * States where test execution is allowed
 */
const TEST_ALLOWED_STATES: Set<WorkflowState> = new Set(['QA']);

/**
 * States where full write/exec authority is granted
 */
const FULL_AUTHORITY_STATES: Set<WorkflowState> = new Set(['IMPLEMENTING', 'REFACTOR']);

/**
 * Result of processing natural language approval
 */
export interface NaturalLanguageApprovalResult {
  approved: boolean;
  newState?: WorkflowState;
  intentResult: IntentResult;
  action: 'direct_apply' | 'confirm' | 'no_change';
}

/**
 * State machine for workflow management
 */
export class StateMachine {
  private currentState: WorkflowState;
  private history: Array<{ from: WorkflowState; to: WorkflowState; timestamp: string; reason?: string }>;
  private approvalMode: ApprovalMode;
  private planConfidence: number;
  private approvalThreshold: number;
  private confirmThreshold: number;
  private intentClassifier: IntentClassifier;

  constructor(
    initialState: WorkflowState = 'PRD_INTAKE',
    approvalMode: ApprovalMode = 'balanced',
    intentClassifierOptions?: Partial<IntentClassifierOptions>
  ) {
    this.currentState = initialState;
    this.history = [];
    this.approvalMode = approvalMode;
    this.planConfidence = 0;
    this.approvalThreshold = intentClassifierOptions?.approveThreshold ?? 0.85;
    this.confirmThreshold = intentClassifierOptions?.confirmThreshold ?? 0.60;
    this.intentClassifier = new IntentClassifier({
      approveThreshold: this.approvalThreshold,
      confirmThreshold: this.confirmThreshold,
      conflictPolicy: intentClassifierOptions?.conflictPolicy ?? 'deny_over_approve',
      ...intentClassifierOptions,
    });
  }

  /**
   * Get current state
   */
  getState(): WorkflowState {
    return this.currentState;
  }

  /**
   * Set current state directly (for restoration from checkpoint)
   */
  setState(state: WorkflowState): void {
    this.currentState = state;
  }

  /**
   * Check if transition is valid
   */
  canTransitionTo(targetState: WorkflowState): boolean {
    return VALID_TRANSITIONS[this.currentState]?.includes(targetState) ?? false;
  }

  /**
   * Transition to a new state
   */
  transition(targetState: WorkflowState, reason?: string): boolean {
    if (!this.canTransitionTo(targetState)) {
      return false;
    }

    const previousState = this.currentState;
    this.currentState = targetState;
    const entry: { from: WorkflowState; to: WorkflowState; timestamp: string; reason?: string } = {
      from: previousState,
      to: targetState,
      timestamp: new Date().toISOString(),
    };
    if (reason !== undefined) {
      entry.reason = reason;
    }
    this.history.push(entry);

    return true;
  }

  /**
   * Force transition (bypass validation - use carefully)
   */
  forceTransition(targetState: WorkflowState, reason?: string): void {
    const previousState = this.currentState;
    this.currentState = targetState;
    this.history.push({
      from: previousState,
      to: targetState,
      timestamp: new Date().toISOString(),
      reason: reason ?? 'forced transition',
    });
  }

  /**
   * Get transition history
   */
  getHistory(): Array<{ from: WorkflowState; to: WorkflowState; timestamp: string; reason?: string }> {
    return [...this.history];
  }

  /**
   * Check if write/exec operations are allowed in current state
   */
  isWriteAllowed(): boolean {
    return !WRITE_BLOCKED_STATES.has(this.currentState);
  }

  /**
   * Check if only read operations are allowed
   */
  isReadOnly(): boolean {
    return READ_ONLY_STATES.has(this.currentState);
  }

  /**
   * Check if test execution is allowed
   */
  isTestAllowed(): boolean {
    return TEST_ALLOWED_STATES.has(this.currentState) || FULL_AUTHORITY_STATES.has(this.currentState);
  }

  /**
   * Check if full authority is granted
   */
  hasFullAuthority(): boolean {
    return FULL_AUTHORITY_STATES.has(this.currentState);
  }

  /**
   * Set approval mode
   */
  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode;
  }

  /**
   * Get approval mode
   */
  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }

  /**
   * Set plan confidence score
   */
  setPlanConfidence(confidence: number): void {
    this.planConfidence = Math.max(0, Math.min(1, confidence));
  }

  /**
   * Get plan confidence score
   */
  getPlanConfidence(): number {
    return this.planConfidence;
  }

  /**
   * Get approval threshold
   */
  getApprovalThreshold(): number {
    return this.approvalThreshold;
  }

  /**
   * Set approval threshold
   */
  setApprovalThreshold(threshold: number): void {
    this.approvalThreshold = Math.max(0, Math.min(1, threshold));
    this.intentClassifier.setOptions({ approveThreshold: this.approvalThreshold });
  }

  /**
   * Get confirm threshold
   */
  getConfirmThreshold(): number {
    return this.confirmThreshold;
  }

  /**
   * Set confirm threshold
   */
  setConfirmThreshold(threshold: number): void {
    this.confirmThreshold = Math.max(0, Math.min(1, threshold));
    this.intentClassifier.setOptions({ confirmThreshold: this.confirmThreshold });
  }

  /**
   * Process approval decision in AWAITING_PLAN_CONFIRMATION state
   */
  processApproval(decision: ApprovalDecision): { approved: boolean; newState?: WorkflowState } {
    if (this.currentState !== 'AWAITING_PLAN_CONFIRMATION') {
      return { approved: false };
    }

    switch (decision) {
      case 'approve':
        // Explicit approvals and high-confidence NL approvals can start implementation.
        this.transition('IMPLEMENTING', 'Plan approved');
        return { approved: true, newState: 'IMPLEMENTING' };

      case 'revise':
        this.transition('PLAN_DRAFTED', 'Plan revision requested');
        return { approved: false, newState: 'PLAN_DRAFTED' };

      case 'ask':
        // Stay in current state for Q&A
        return { approved: false };

      case 'deny':
        this.transition('PLAN_DRAFTED', 'Plan denied');
        return { approved: false, newState: 'PLAN_DRAFTED' };

      default:
        return { approved: false };
    }
  }

  /**
   * Process natural language approval - PRD Section 4.2
   * Classifies user input and determines action based on confidence thresholds
   */
  processNaturalLanguageApproval(input: string): NaturalLanguageApprovalResult {
    if (this.currentState !== 'AWAITING_PLAN_CONFIRMATION') {
      return {
        approved: false,
        intentResult: {
          intent: 'ask',
          confidence: 0,
          reasoning: 'Not in AWAITING_PLAN_CONFIRMATION state',
        },
        action: 'no_change',
      };
    }

    // Classify the user's intent
    const intentResult = this.intentClassifier.classify(input);

    // Determine action based on confidence
    let action: 'direct_apply' | 'confirm' | 'no_change';
    if (intentResult.confidence >= this.approvalThreshold) {
      action = 'direct_apply';
    } else if (intentResult.confidence >= this.confirmThreshold) {
      action = 'confirm';
    } else {
      action = 'no_change';
    }

    // Process the classified intent
    let approved = false;
    let newState: WorkflowState | undefined;

    // Only apply changes if confidence is high enough
    if (action === 'direct_apply') {
      const decisionResult = this.processApproval(intentResult.intent);
      approved = decisionResult.approved;
      newState = decisionResult.newState;
    }

    const result: NaturalLanguageApprovalResult = {
      approved,
      intentResult,
      action,
    };
    if (newState !== undefined) {
      result.newState = newState;
    }
    return result;
  }

  /**
   * Get intent classifier for direct access
   */
  getIntentClassifier(): IntentClassifier {
    return this.intentClassifier;
  }

  /**
   * Get valid next states
   */
  getValidNextStates(): WorkflowState[] {
    return [...(VALID_TRANSITIONS[this.currentState] ?? [])];
  }

  /**
   * Check if state is a planning state
   */
  isPlanningState(): boolean {
    return ['PRD_INTAKE', 'PRD_CLARIFYING', 'PLAN_DRAFTED', 'AWAITING_PLAN_CONFIRMATION'].includes(this.currentState);
  }

  /**
   * Check if state is an execution state
   */
  isExecutionState(): boolean {
    return ['IMPLEMENTING', 'REFACTOR'].includes(this.currentState);
  }

  /**
   * Check if state is a validation state
   */
  isValidationState(): boolean {
    return ['QA', 'REVIEW'].includes(this.currentState);
  }

  /**
   * Reset state machine to initial state
   */
  reset(): void {
    this.currentState = 'PRD_INTAKE';
    this.history = [];
    this.planConfidence = 0;
  }
}

export { VALID_TRANSITIONS, WRITE_BLOCKED_STATES, READ_ONLY_STATES, TEST_ALLOWED_STATES, FULL_AUTHORITY_STATES };
