import { describe, expect, it } from 'vitest';
import { createWorkflowRuntime } from './workflow-runtime.js';

describe('WorkflowRuntime', () => {
  it('enforces plan lock before build', async () => {
    const runtime = createWorkflowRuntime({
      cwd: process.cwd(),
      model: 'gpt-5.3-codex',
      projectId: 'runtime-test-plan-lock',
      persistEvents: false,
    });

    await runtime.runFromInput('Add a new auth endpoint with tests');
    expect(runtime.getState()).toBe('AWAITING_PLAN_CONFIRMATION');

    const result = await runtime.runFromInput('/build');

    expect(result.status).toBe('needs_input');
    expect(runtime.getState()).toBe('AWAITING_PLAN_CONFIRMATION');
  });

  it('stays in IMPLEMENTING until diff review is completed', async () => {
    const runtime = createWorkflowRuntime({
      cwd: process.cwd(),
      model: 'gpt-5.3-codex',
      projectId: 'runtime-test-approve',
      persistEvents: false,
    });

    await runtime.runFromInput('Implement status page enhancements');
    const result = await runtime.runFromInput('/plan approve');

    expect(result.status).toBe('success');
    expect(runtime.getState()).toBe('IMPLEMENTING');

    const pendingDiffs = runtime.getPendingDiffs();
    expect(pendingDiffs.length).toBeGreaterThan(0);
    expect(pendingDiffs[0]?.status).toBe('pending');

    const qaBeforeApproval = await runtime.runFromInput('/qa');
    expect(qaBeforeApproval.status).toBe('needs_input');
  });

  it('applies only selected hunk during partial approval', async () => {
    const runtime = createWorkflowRuntime({
      cwd: process.cwd(),
      model: 'gpt-5.3-codex',
      projectId: 'runtime-test-partial-diff',
      persistEvents: false,
    });

    await runtime.runFromInput('Ship release checks');
    await runtime.runFromInput('/plan approve');

    const beforeApproval = runtime.getPendingDiffs()[0];
    expect(beforeApproval).toBeDefined();
    expect(beforeApproval?.hunks.length).toBeGreaterThan(1);

    const diffResult = await runtime.runFromInput('/diff approve 1');
    expect(diffResult.status).toBe('success');
    expect(runtime.getState()).toBe('QA');

    const afterApproval = runtime.getPendingDiffs()[0];
    expect(afterApproval?.status).toBe('applied');
    expect(afterApproval?.hunks[0]?.status).toBe('approved');
    expect(afterApproval?.hunks[1]?.status).toBe('rejected');

    const qaResult = await runtime.runFromInput('/qa');
    expect(qaResult.status).toBe('success');
    expect(runtime.getState()).toBe('REVIEW');
  });

  it('does not run QA when all diff hunks are rejected', async () => {
    const runtime = createWorkflowRuntime({
      cwd: process.cwd(),
      model: 'gpt-5.3-codex',
      projectId: 'runtime-test-reject-diff',
      persistEvents: false,
    });

    await runtime.runFromInput('Ship release checks');
    await runtime.runFromInput('/plan approve');
    const diffRejectResult = await runtime.runFromInput('/diff reject all');
    expect(diffRejectResult.status).toBe('success');
    expect(runtime.getState()).toBe('IMPLEMENTING');

    const rejectedDiff = runtime.getPendingDiffs()[0];
    expect(rejectedDiff?.status).toBe('rejected');
    expect(rejectedDiff?.hunks.every((hunk) => hunk.status === 'rejected')).toBe(true);

    const qaResult = await runtime.runFromInput('/qa');
    expect(qaResult.status).toBe('blocked');
    expect(runtime.getState()).toBe('IMPLEMENTING');
  });
});
