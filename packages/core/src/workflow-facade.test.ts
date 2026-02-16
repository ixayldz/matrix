import { describe, expect, it } from 'vitest';
import type { AgentContext } from './orchestrator.js';
import { createOrchestrator } from './orchestrator.js';
import { createWorkflowFacade } from './workflow-facade.js';

function createStubAgent(content: string, transitionTo?: AgentContext['state']) {
  return async (context: AgentContext) => {
    if (transitionTo) {
      context.transition(transitionTo, `Stub transition to ${transitionTo}`);
    }
    return {
      role: 'assistant' as const,
      content,
    };
  };
}

function buildFacade() {
  const orchestrator = createOrchestrator({
    projectId: 'test-project',
    workingDirectory: process.cwd(),
    persistEvents: false,
  });

  orchestrator.registerAgent(
    'plan_agent',
    async (context) => {
      if (context.state === 'PRD_INTAKE' || context.state === 'PRD_CLARIFYING') {
        context.transition('PLAN_DRAFTED', 'Stub plan drafted');
      }
      context.transition('AWAITING_PLAN_CONFIRMATION', 'Stub plan awaiting approval');
      return {
        role: 'assistant',
        content: 'Plan drafted. Reply with approve/start/yes.',
      };
    }
  );
  orchestrator.registerAgent('builder_agent', createStubAgent('Implementation complete.', 'QA'));
  orchestrator.registerAgent('qa_agent', createStubAgent('Tests passed.'));
  orchestrator.registerAgent('review_agent', createStubAgent('Review complete.', 'REFACTOR'));
  orchestrator.registerAgent('refactor_agent', createStubAgent('Refactor complete.', 'DONE'));

  return createWorkflowFacade(orchestrator);
}

describe('WorkflowFacade', () => {
  it('blocks build when awaiting plan confirmation', async () => {
    const facade = buildFacade();
    await facade.processUserInput('create a plan');
    expect(facade.getState()).toBe('AWAITING_PLAN_CONFIRMATION');

    const result = await facade.runBuild();

    expect(result.status).toBe('needs_input');
    expect(result.state).toBe('AWAITING_PLAN_CONFIRMATION');
  });

  it('moves to implementing when approval is explicit', async () => {
    const facade = buildFacade();
    await facade.processUserInput('create a plan');

    const result = await facade.submitPlanDecision('/plan approve');

    expect(result.status).toBe('success');
    expect(facade.getState()).toBe('QA');
  });

  it('returns needs_input for ambiguous approval language', async () => {
    const facade = buildFacade();
    await facade.processUserInput('create a plan');

    const result = await facade.submitPlanDecision('yes but no');

    expect(result.status).toBe('needs_input');
    expect(result.approval?.action).not.toBe('direct_apply');
  });
});
