import { describe, expect, it } from 'vitest';
import type { WorkflowState, AgentType } from '@matrix/core';
import type { CommandContext } from './index.js';
import { executeCommand, getCommandNames } from './index.js';

function createContext(initialState: WorkflowState = 'PRD_INTAKE'): CommandContext {
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
      // no-op in tests
    },
    setError: () => {
      // no-op in tests
    },
  };

  return context;
}

describe('TUI command compatibility', () => {
  it('includes PRD baseline slash commands', () => {
    const names = new Set(getCommandNames());
    const required = [
      'new',
      'resume',
      'fork',
      'export',
      'import',
      'clear',
      'init',
      'status',
      'context',
      'rules',
      'plan',
      'build',
      'qa',
      'review',
      'refactor',
      'stop',
      'model',
      'auth',
      'quota',
      'telemetry',
      'tools',
      'mcp',
      'approval',
      'sandbox',
    ];

    for (const command of required) {
      expect(names.has(command), `missing command /${command}`).toBe(true);
    }
  });

  it('supports /context policy management flow', async () => {
    const context = createContext();

    const show = await executeCommand('/context policy', context);
    expect(show.success).toBe(true);
    expect(show.action).toBe('manage_context_policy');

    const setStrict = await executeCommand('/context policy strict', context);
    expect(setStrict.success).toBe(true);
    expect(setStrict.action).toBe('manage_context_policy');
    expect(setStrict.data?.mode).toBe('strict');

    const invalid = await executeCommand('/context policy ultra', context);
    expect(invalid.success).toBe(false);
    expect(invalid.status).toBe('error');
  });
});
