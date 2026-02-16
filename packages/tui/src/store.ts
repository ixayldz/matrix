import { create } from 'zustand';
import type { WorkflowState, Message, DiffInfo, AgentType } from '@matrix/core';

/**
 * TUI State
 */
export interface TUIState {
  // Workflow state
  workflowState: WorkflowState;
  setWorkflowState: (state: WorkflowState) => void;

  // Messages
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  clearMessages: () => void;

  // Current input
  input: string;
  setInput: (input: string) => void;

  // Streaming
  isStreaming: boolean;
  streamingContent: string;
  setStreaming: (streaming: boolean, content?: string) => void;

  // Agent
  currentAgent: AgentType | null;
  setCurrentAgent: (agent: AgentType | null) => void;

  // Diffs
  pendingDiffs: DiffInfo[];
  setPendingDiffs: (diffs: DiffInfo[]) => void;
  addPendingDiff: (diff: DiffInfo) => void;
  approveDiff: (diffId: string) => void;
  rejectDiff: (diffId: string) => void;
  clearPendingDiffs: () => void;

  // Files
  selectedFile: string | null;
  setSelectedFile: (file: string | null) => void;
  modifiedFiles: string[];
  setModifiedFiles: (files: string[]) => void;

  // Tokens
  tokenUsage: { input: number; output: number; total: number };
  setTokenUsage: (usage: { input: number; output: number; total: number }) => void;

  // Model
  currentModel: string;
  setCurrentModel: (model: string) => void;

  // Panel focus
  focusedPanel: 'chat' | 'files' | 'diff' | 'session';
  setFocusedPanel: (panel: 'chat' | 'files' | 'diff' | 'session') => void;

  // Status
  statusMessage: string;
  setStatusMessage: (message: string) => void;

  // Errors
  error: string | null;
  setError: (error: string | null) => void;

  // Submit handler for input
  onSubmit: ((input: string) => void) | undefined;
  setOnSubmit: (handler: ((input: string) => void) | undefined) => void;

  // Session ID
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  sessionStartedAt: string | null;
  setSessionStartedAt: (timestamp: string | null) => void;
}

/**
 * Create TUI store
 */
export const useStore = create<TUIState>((set) => ({
  // Workflow state
  workflowState: 'PRD_INTAKE',
  setWorkflowState: (state: WorkflowState) => set({ workflowState: state }),

  // Messages
  messages: [],
  setMessages: (messages: Message[]) => set({ messages: [...messages] }),
  addMessage: (message: Message) => set((state: TUIState) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  // Input
  input: '',
  setInput: (input: string) => set({ input }),

  // Streaming
  isStreaming: false,
  streamingContent: '',
  setStreaming: (streaming: boolean, content: string = '') => set({ isStreaming: streaming, streamingContent: content }),

  // Agent
  currentAgent: null,
  setCurrentAgent: (agent: AgentType | null) => set({ currentAgent: agent }),

  // Diffs
  pendingDiffs: [],
  setPendingDiffs: (diffs: DiffInfo[]) => set({ pendingDiffs: [...diffs] }),
  addPendingDiff: (diff: DiffInfo) => set((state: TUIState) => ({ pendingDiffs: [...state.pendingDiffs, diff] })),
  approveDiff: (diffId: string) => set((state: TUIState) => ({
    pendingDiffs: state.pendingDiffs.filter((d: DiffInfo) => d.id !== diffId),
  })),
  rejectDiff: (diffId: string) => set((state: TUIState) => ({
    pendingDiffs: state.pendingDiffs.filter((d: DiffInfo) => d.id !== diffId),
  })),
  clearPendingDiffs: () => set({ pendingDiffs: [] }),

  // Files
  selectedFile: null,
  setSelectedFile: (file: string | null) => set({ selectedFile: file }),
  modifiedFiles: [],
  setModifiedFiles: (files: string[]) => set({ modifiedFiles: files }),

  // Tokens
  tokenUsage: { input: 0, output: 0, total: 0 },
  setTokenUsage: (usage: { input: number; output: number; total: number }) => set({ tokenUsage: usage }),

  // Model
  currentModel: 'gpt-5.3-codex',
  setCurrentModel: (model: string) => set({ currentModel: model }),

  // Panel focus
  focusedPanel: 'chat',
  setFocusedPanel: (panel: 'chat' | 'files' | 'diff' | 'session') => set({ focusedPanel: panel }),

  // Status
  statusMessage: 'Ready',
  setStatusMessage: (message: string) => set({ statusMessage: message }),

  // Errors
  error: null,
  setError: (error: string | null) => set({ error }),

  // Submit handler
  onSubmit: undefined,
  setOnSubmit: (handler: ((input: string) => void) | undefined) => set({ onSubmit: handler }),

  // Session ID
  sessionId: null,
  setSessionId: (id: string | null) => set({ sessionId: id }),
  sessionStartedAt: null,
  setSessionStartedAt: (timestamp: string | null) => set({ sessionStartedAt: timestamp }),
}));
