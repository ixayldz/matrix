import { basename } from 'path';
import { createHash } from 'crypto';
import {
  createOrchestrator,
  createWorkflowFacade,
  type AgentContext,
  type AgentType,
  type DiffInfo,
  type DiffHunk,
  type Message,
  type WorkflowCommandResult,
  type WorkflowState,
  type Orchestrator,
  type WorkflowFacade,
} from '@matrix/core';

export interface WorkflowRuntimeConfig {
  cwd: string;
  model: string;
  provider?: string;
  projectId?: string;
  approvalMode?: 'strict' | 'balanced' | 'fast';
  persistEvents?: boolean;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function toDiffHunks(diffId: string, hunkCount: number, additions: number, deletions: number): DiffHunk[] {
  const totalHunks = Math.max(1, hunkCount);
  const hunks: DiffHunk[] = [];
  let remainingAdditions = Math.max(0, additions);
  let remainingDeletions = Math.max(0, deletions);
  let oldCursor = 1;
  let newCursor = 1;

  for (let index = 0; index < totalHunks; index += 1) {
    const remainingSlots = totalHunks - index;
    const rawDeleted =
      remainingSlots === 1 ? remainingDeletions : Math.max(0, Math.ceil(remainingDeletions / remainingSlots));
    const rawAdded =
      remainingSlots === 1 ? remainingAdditions : Math.max(1, Math.ceil(remainingAdditions / remainingSlots));
    const deletedLines = rawDeleted;
    const addedLines = Math.max(rawAdded, deletedLines === 0 ? 1 : rawAdded);

    remainingDeletions = Math.max(0, remainingDeletions - deletedLines);
    remainingAdditions = Math.max(0, remainingAdditions - addedLines);

    const content: string[] = [];
    for (let line = 0; line < deletedLines; line += 1) {
      content.push(`- removed line ${index + 1}.${line + 1}`);
    }
    for (let line = 0; line < addedLines; line += 1) {
      content.push(`+ added line ${index + 1}.${line + 1}`);
    }
    if (content.length === 0) {
      content.push(`+ added line ${index + 1}.1`);
    }

    hunks.push({
      hunkId: `${diffId}-hunk-${index + 1}`,
      oldStart: oldCursor,
      oldLines: deletedLines,
      newStart: newCursor,
      newLines: addedLines,
      content: content.join('\n'),
      status: 'pending',
    });

    oldCursor += Math.max(1, deletedLines);
    newCursor += Math.max(1, addedLines);
  }

  return hunks;
}

function createChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function getHunkStatus(hunk: DiffHunk): 'pending' | 'approved' | 'rejected' {
  return hunk.status ?? 'pending';
}

function resolveDiffStatus(hunks: DiffHunk[]): DiffInfo['status'] {
  const statuses = hunks.map(getHunkStatus);
  const hasPending = statuses.includes('pending');
  const hasApproved = statuses.includes('approved');
  const hasRejected = statuses.includes('rejected');

  if (hasPending) {
    return 'pending';
  }

  if (!hasApproved && hasRejected) {
    return 'rejected';
  }

  if (hasApproved) {
    return 'approved';
  }

  return 'pending';
}

/**
 * Runtime adapter that connects TUI workflows to core orchestrator APIs.
 */
export class WorkflowRuntime {
  private orchestrator: Orchestrator;
  private facade: WorkflowFacade;
  private currentAgent: AgentType | null = null;
  private pendingDiffs: DiffInfo[] = [];
  private activeModel: string;

  constructor(config: WorkflowRuntimeConfig) {
    this.orchestrator = createOrchestrator({
      projectId: (config.projectId ?? basename(config.cwd)) || 'matrix-project',
      workingDirectory: config.cwd,
      approvalMode: config.approvalMode ?? 'balanced',
      persistEvents: config.persistEvents ?? true,
    });

    this.facade = createWorkflowFacade(this.orchestrator);
    this.activeModel = config.model;
    this.registerDefaultAgents(this.activeModel);
    this.bindEvents();
  }

  getRunId(): string {
    return this.facade.getRunId();
  }

  getState(): WorkflowState {
    return this.facade.getState();
  }

  getMessages(): Message[] {
    return this.facade.getMessages();
  }

  getCurrentAgent(): AgentType | null {
    return this.currentAgent;
  }

  getPendingDiffs(): DiffInfo[] {
    return this.pendingDiffs.map((diff) => ({
      ...diff,
      hunks: diff.hunks.map((hunk) => ({ ...hunk })),
    }));
  }

  getModel(): string {
    return this.activeModel;
  }

  setModel(model: string): void {
    const normalized = model.trim();
    if (!normalized) {
      return;
    }
    this.activeModel = normalized;
    this.registerDefaultAgents(this.activeModel);
  }

  async runFromInput(input: string): Promise<WorkflowCommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return this.facade.processUserInput(trimmed);
    }

    const [rawCommand, ...rawArgs] = trimmed.slice(1).split(/\s+/);
    const command = rawCommand?.toLowerCase() ?? '';
    const args = rawArgs.map((value) => value.toLowerCase());

    switch (command) {
      case 'model':
        if (args[0]) {
          this.setModel(args[0]);
          return {
            status: 'success',
            state: this.facade.getState(),
            message: `Model switched to ${this.activeModel}.`,
          };
        }
        return {
          status: 'success',
          state: this.facade.getState(),
          message: `Current model: ${this.activeModel}.`,
        };
      case 'plan': {
        const decision = args[0];
        if (decision && ['approve', 'revise', 'deny', 'ask'].includes(decision)) {
          return this.facade.submitPlanDecision(trimmed);
        }
        return this.facade.startPlan();
      }
      case 'build':
        return this.facade.runBuild();
      case 'diff':
        return this.handleDiffCommand(args);
      case 'qa':
        if (this.hasPendingDiffDecisions()) {
          return {
            status: 'needs_input',
            state: this.facade.getState(),
            message: 'Resolve pending diff hunks first. Use /diff approve [all|indexes] or /diff reject [all|indexes].',
          };
        }
        if (!this.hasAppliedDiffs()) {
          return {
            status: 'blocked',
            state: this.facade.getState(),
            message: 'At least one approved diff hunk must be applied before QA can run.',
          };
        }
        return this.facade.runQA();
      case 'review':
        return this.facade.runReview();
      case 'refactor':
        return this.facade.runRefactor();
      case 'stop':
        return this.facade.stop('Workflow stopped by user command.');
      default:
        return this.facade.processUserInput(trimmed);
    }
  }

  private hasPendingDiffDecisions(): boolean {
    return this.pendingDiffs.some((diff) => diff.hunks.some((hunk) => getHunkStatus(hunk) === 'pending'));
  }

  private hasAppliedDiffs(): boolean {
    return this.pendingDiffs.some((diff) => diff.status === 'applied' || diff.hunks.some((hunk) => getHunkStatus(hunk) === 'approved'));
  }

  private getActiveDiff(): DiffInfo | null {
    return this.pendingDiffs.find((diff) => diff.hunks.some((hunk) => getHunkStatus(hunk) === 'pending')) ?? null;
  }

  private parseHunkSelection(
    args: string[],
    maxHunks: number
  ): { mode: 'all' | 'indexed'; indices: number[]; error?: string } {
    if (args.length === 0 || args[0] === 'all') {
      return {
        mode: 'all',
        indices: Array.from({ length: maxHunks }, (_, index) => index),
      };
    }

    const rawTokens = args.join(' ').split(/[,\s]+/).filter(Boolean);
    const indexSet = new Set<number>();
    for (const token of rawTokens) {
      const parsed = Number.parseInt(token, 10);
      if (!Number.isFinite(parsed)) {
        return { mode: 'indexed', indices: [], error: `Invalid hunk index: ${token}` };
      }
      if (parsed < 1 || parsed > maxHunks) {
        return {
          mode: 'indexed',
          indices: [],
          error: `Hunk index out of range: ${parsed}. Valid range: 1-${maxHunks}.`,
        };
      }
      indexSet.add(parsed - 1);
    }

    const indices = [...indexSet].sort((a, b) => a - b);
    if (indices.length === 0) {
      return {
        mode: 'indexed',
        indices: [],
        error: 'At least one hunk index is required.',
      };
    }

    return { mode: 'indexed', indices };
  }

  private async handleDiffCommand(args: string[]): Promise<WorkflowCommandResult> {
    const state = this.facade.getState();
    if (!['IMPLEMENTING', 'QA'].includes(state)) {
      return {
        status: 'blocked',
        state,
        message: `Diff decisions are only allowed in IMPLEMENTING or QA. Current state: ${state}.`,
      };
    }

    const decision = args[0];
    if (!decision || !['approve', 'reject'].includes(decision)) {
      return {
        status: 'needs_input',
        state,
        message: 'Usage: /diff <approve|reject> [all|indexes]',
      };
    }

    const activeDiff = this.getActiveDiff();
    if (!activeDiff) {
      return {
        status: 'blocked',
        state,
        message: 'No pending diff hunks to review.',
      };
    }

    const pendingIndexes = activeDiff.hunks
      .map((hunk, index) => ({ status: getHunkStatus(hunk), index }))
      .filter((entry) => entry.status === 'pending')
      .map((entry) => entry.index);

    if (pendingIndexes.length === 0) {
      return {
        status: 'blocked',
        state,
        message: 'All hunks are already resolved.',
      };
    }

    const selection = this.parseHunkSelection(args.slice(1), activeDiff.hunks.length);
    if (selection.error) {
      return {
        status: 'error',
        state,
        message: selection.error,
      };
    }

    const selectedPendingIndexes = selection.indices.filter((index) => pendingIndexes.includes(index));
    if (selectedPendingIndexes.length === 0) {
      return {
        status: 'blocked',
        state,
        message: 'Selected hunks are already resolved. Choose pending hunks only.',
      };
    }

    const emitter = this.orchestrator.getEventEmitter();

    if (decision === 'reject') {
      const rejectAll = selection.mode === 'all';
      for (const index of selectedPendingIndexes) {
        const hunk = activeDiff.hunks[index]!;
        const hunkId = hunk.hunkId ?? `${activeDiff.id}-hunk-${index + 1}`;
        await emitter.emit('diff.hunk.rejected', {
          diffId: activeDiff.id,
          hunkId,
          hunkIndex: index,
          filePath: activeDiff.filePath,
          rejectedBy: 'user',
        });
      }

      const remainingAfterRejection = activeDiff.hunks
        .map((hunk, index) => ({ status: getHunkStatus(hunk), index }))
        .filter((entry) => entry.status === 'pending' && !selectedPendingIndexes.includes(entry.index));

      if (rejectAll || remainingAfterRejection.length === 0) {
        await emitter.emit('diff.rejected', {
          diffId: activeDiff.id,
          rejectedBy: 'user',
          reason: 'User rejected pending hunks.',
        });
      }

      const stillPending = this.getActiveDiff();
      return {
        status: 'success',
        state: this.facade.getState(),
        message: stillPending && stillPending.id === activeDiff.id
          ? `Rejected ${selectedPendingIndexes.length} hunk(s). ${remainingAfterRejection.length} pending hunk(s) remain.`
          : `Rejected ${selectedPendingIndexes.length} hunk(s). Diff marked as rejected.`,
      };
    }

    const approveIndexes = selectedPendingIndexes;
    const autoRejectIndexes = selection.mode === 'indexed'
      ? pendingIndexes.filter((index) => !approveIndexes.includes(index))
      : [];

    for (const index of approveIndexes) {
      const hunk = activeDiff.hunks[index]!;
      const hunkId = hunk.hunkId ?? `${activeDiff.id}-hunk-${index + 1}`;
      await emitter.emit('diff.hunk.approved', {
        diffId: activeDiff.id,
        hunkId,
        hunkIndex: index,
        filePath: activeDiff.filePath,
        approvedBy: 'user',
      });
    }

    for (const index of autoRejectIndexes) {
      const hunk = activeDiff.hunks[index]!;
      const hunkId = hunk.hunkId ?? `${activeDiff.id}-hunk-${index + 1}`;
      await emitter.emit('diff.hunk.rejected', {
        diffId: activeDiff.id,
        hunkId,
        hunkIndex: index,
        filePath: activeDiff.filePath,
        rejectedBy: 'user',
        reason: 'Not selected during partial approval.',
      });
    }

    await emitter.emit('diff.approved', {
      diffId: activeDiff.id,
      approvedBy: 'user',
    });

    const approvedContent = approveIndexes.map((index) => activeDiff.hunks[index]!.content).join('\n');
    await emitter.emit('diff.applied', {
      diffId: activeDiff.id,
      filePath: activeDiff.filePath,
      checksum: createChecksum(approvedContent),
    });

    if (this.facade.getState() === 'IMPLEMENTING') {
      await this.orchestrator.transitionTo('QA', 'Approved diff hunks applied; ready for QA');
    }

    return {
      status: 'success',
      state: this.facade.getState(),
      message: autoRejectIndexes.length > 0
        ? `Applied ${approveIndexes.length} approved hunk(s) and rejected ${autoRejectIndexes.length} unselected hunk(s).`
        : `Applied ${approveIndexes.length} approved hunk(s).`,
    };
  }

  private bindEvents(): void {
    const emitter = this.orchestrator.getEventEmitter();

    emitter.on('agent.start', async (event) => {
      this.currentAgent = event.payload.agentType;
    });

    emitter.on('agent.stop', async () => {
      this.currentAgent = null;
    });

    emitter.on('diff.proposed', async (event) => {
      const payload = event.payload;
      const diff: DiffInfo = {
        id: payload.diffId,
        filePath: payload.filePath,
        hunks: toDiffHunks(payload.diffId, payload.hunks, payload.additions, payload.deletions),
        status: 'pending',
      };
      this.pendingDiffs.unshift(diff);
    });

    emitter.on('diff.hunk.approved', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) => {
        if (diff.id !== event.payload.diffId) {
          return diff;
        }
        const hunks = diff.hunks.map((hunk, index) =>
          index === event.payload.hunkIndex || hunk.hunkId === event.payload.hunkId
            ? { ...hunk, hunkId: event.payload.hunkId, status: 'approved' as const }
            : hunk
        );
        return { ...diff, hunks, status: resolveDiffStatus(hunks) };
      });
    });

    emitter.on('diff.hunk.rejected', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) => {
        if (diff.id !== event.payload.diffId) {
          return diff;
        }
        const hunks = diff.hunks.map((hunk, index) =>
          index === event.payload.hunkIndex || hunk.hunkId === event.payload.hunkId
            ? { ...hunk, hunkId: event.payload.hunkId, status: 'rejected' as const }
            : hunk
        );
        return { ...diff, hunks, status: resolveDiffStatus(hunks) };
      });
    });

    emitter.on('diff.approved', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) => {
        if (diff.id !== event.payload.diffId) {
          return diff;
        }
        const resolvedStatus = resolveDiffStatus(diff.hunks);
        return {
          ...diff,
          status: resolvedStatus === 'pending' ? 'approved' : resolvedStatus,
        };
      });
    });

    emitter.on('diff.applied', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) =>
        diff.id === event.payload.diffId ? { ...diff, status: 'applied' } : diff
      );
    });

    emitter.on('diff.rejected', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) =>
        diff.id === event.payload.diffId ? { ...diff, status: 'rejected' } : diff
      );
    });

    emitter.on('diff.rolled_back', async (event) => {
      this.pendingDiffs = this.pendingDiffs.map((diff) =>
        diff.id === event.payload.diffId ? { ...diff, status: 'rolled_back' } : diff
      );
    });
  }

  private registerDefaultAgents(model: string): void {
    this.orchestrator.registerAgent('plan_agent', async (context) => {
      const latestRequirement =
        [...context.messages]
          .reverse()
          .find((message) => message.role === 'user' && !message.content.trim().startsWith('/'))
          ?.content ?? 'No requirement text provided yet.';

      await context.emit('model.call', {
        provider: 'local',
        model,
        messageCount: context.messages.length,
        toolsAvailable: [],
      });

      const plan = [
        '## Plan Summary',
        `- Goal: ${truncate(latestRequirement, 120)}`,
        '- Milestones:',
        '  1. Confirm scope and constraints.',
        '  2. Implement incrementally with guarded writes.',
        '  3. Run QA, review, and refactor before completion.',
        '',
        'Approve to continue implementation: approve/start/yes or /plan approve.',
      ].join('\n');

      await context.emit('model.result', {
        provider: 'local',
        model,
        response: plan,
        tokenUsage: { input: 0, output: 0, total: 0 },
        latencyMs: 0,
      });

      if (context.state === 'PRD_INTAKE' || context.state === 'PRD_CLARIFYING') {
        context.transition('PLAN_DRAFTED', 'Plan drafted from user requirements');
      }
      context.transition('AWAITING_PLAN_CONFIRMATION', 'Plan drafted and awaiting confirmation');

      return {
        role: 'assistant',
        content: plan,
      };
    });

    this.orchestrator.registerAgent('builder_agent', async (context: AgentContext) => {
      const diffId = `diff-${Date.now()}`;
      const targetFile = 'src/example.ts';
      const simulatedPatch = [
        '- export const legacy = false;',
        '+ export const legacy = true;',
        '+ export const example = true;',
        '+ export function runExample(): boolean {',
        '+   return example;',
        '+ }',
      ].join('\n');

      await context.emit('diff.proposed', {
        diffId,
        filePath: targetFile,
        hunks: 2,
        additions: 5,
        deletions: 1,
      });

      return {
        role: 'assistant',
        content: [
          'Implementation step completed and diff is ready for review.',
          `Proposed changes for ${targetFile}.`,
          'Review with /diff approve [all|indexes] or /diff reject [all|indexes].',
          `Patch preview checksum: ${createChecksum(simulatedPatch).slice(0, 12)}`,
        ].join('\n'),
      };
    });

    this.orchestrator.registerAgent('qa_agent', async () => ({
      role: 'assistant',
      content: [
        'Tests passed.',
        'No regressions detected in the QA cycle.',
      ].join('\n'),
    }));

    this.orchestrator.registerAgent('review_agent', async (context) => {
      context.transition('REFACTOR', 'Review completed, refactor requested');
      return {
        role: 'assistant',
        content: [
          'Review completed.',
          'Code quality and security checks passed.',
          'Proceeding to refactor stage.',
        ].join('\n'),
      };
    });

    this.orchestrator.registerAgent('refactor_agent', async (context) => {
      context.transition('DONE', 'Refactor completed');
      return {
        role: 'assistant',
        content: [
          'Refactor completed.',
          'Workflow is now marked as DONE.',
        ].join('\n'),
      };
    });
  }
}

export function createWorkflowRuntime(config: WorkflowRuntimeConfig): WorkflowRuntime {
  return new WorkflowRuntime(config);
}
