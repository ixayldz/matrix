import { describe, expect, it } from 'vitest';
import type { WorkflowState, AgentType } from '@matrix/core';
import type { CommandContext } from './index.js';
import { executeCommand } from './index.js';

function createContext(initialState: WorkflowState): CommandContext {
  const context: CommandContext = {
    workflowState: initialState,
    currentAgent: null,
    currentModel: 'gpt-5.3-codex',
    messages: [],
    modifiedFiles: [],
    pendingDiffs: [],
    setWorkflowState: (state) => {
      context.workflowState = state;
    },
    setCurrentAgent: (agent) => {
      context.currentAgent = agent as AgentType | null;
    },
    setCurrentModel: (model) => {
      context.currentModel = model;
    },
    clearMessages: () => {
      context.messages = [];
    },
    setStatusMessage: () => {
      // no-op for command unit tests
    },
    setError: () => {
      // no-op for command unit tests
    },
  };

  return context;
}

describe('TUI command flow', () => {
  it('blocks /build while awaiting plan confirmation', async () => {
    const context = createContext('AWAITING_PLAN_CONFIRMATION');
    const result = await executeCommand('/build', context);

    expect(result.success).toBe(false);
    expect(result.status).toBe('needs_input');
    expect(result.error).toContain('Plan approval required');
  });

  it('supports /plan approve compat command', async () => {
    const context = createContext('AWAITING_PLAN_CONFIRMATION');
    const result = await executeCommand('/plan approve', context);

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.action).toBe('start_build');
    expect(context.workflowState).toBe('IMPLEMENTING');
    expect(context.currentAgent).toBe('builder_agent');
  });

  it('forwards /diff approve when a pending diff exists', async () => {
    const context = createContext('IMPLEMENTING');
    context.pendingDiffs = [
      {
        id: 'diff-1',
        filePath: 'src/example.ts',
        status: 'pending',
      },
    ];

    const result = await executeCommand('/diff approve 1', context);

    expect(result.success).toBe(true);
    expect(result.status).toBe('success');
    expect(result.action).toBe('review_diff');
  });

  it('blocks /qa before any diff is applied', async () => {
    const context = createContext('IMPLEMENTING');
    context.pendingDiffs = [
      {
        id: 'diff-1',
        filePath: 'src/example.ts',
        status: 'pending',
      },
    ];

    const pendingResult = await executeCommand('/qa', context);
    expect(pendingResult.success).toBe(false);
    expect(pendingResult.status).toBe('needs_input');

    context.pendingDiffs = [
      {
        id: 'diff-1',
        filePath: 'src/example.ts',
        status: 'applied',
      },
    ];

    const appliedResult = await executeCommand('/qa', context);
    expect(appliedResult.success).toBe(true);
    expect(appliedResult.status).toBe('success');
  });

  it('returns normalized error status for unknown commands', async () => {
    const context = createContext('PRD_INTAKE');
    const result = await executeCommand('/does-not-exist', context);

    expect(result.success).toBe(false);
    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown command');
  });
});
