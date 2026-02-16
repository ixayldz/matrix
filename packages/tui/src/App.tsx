import { useEffect, useCallback, useRef } from 'react';
import { render, Box, useApp, useInput } from 'ink';
import { Layout, SplitLayout, Panel } from './components/Layout.js';
import { ChatPanel } from './components/ChatPanel.js';
import { FileTree } from './components/FileTree.js';
import { DiffViewer } from './components/DiffViewer.js';
import { InputBar } from './components/InputBar.js';
import { SessionPanel } from './components/SessionPanel.js';
import { useStore } from './store.js';
import { createWorkflowRuntime, type WorkflowRuntime } from './runtime/workflow-runtime.js';

/**
 * App configuration
 */
export interface AppConfig {
  /** Working directory */
  cwd: string;
  /** Model to use */
  model: string;
  /** API provider */
  provider?: string;
  /** Headless mode */
  headless?: boolean;
}

/**
 * Main Matrix TUI App component
 */
export function MatrixApp({ cwd, model }: AppConfig) {
  const { exit } = useApp();
  const runtimeRef = useRef<WorkflowRuntime | null>(null);
  const {
    setInput,
    setOnSubmit,
    focusedPanel,
    setFocusedPanel,
    setCurrentModel,
    setStatusMessage,
    setError,
    setWorkflowState,
    setMessages,
    setPendingDiffs,
    setCurrentAgent,
    setSessionId,
    setSessionStartedAt,
  } = useStore();

  const syncRuntimeState = useCallback((runtime: WorkflowRuntime) => {
    setWorkflowState(runtime.getState());
    setMessages(runtime.getMessages());
    setPendingDiffs(runtime.getPendingDiffs());
    setCurrentAgent(runtime.getCurrentAgent());
  }, [setWorkflowState, setMessages, setPendingDiffs, setCurrentAgent]);

  // Handle user input through orchestrator runtime
  const handleCommand = useCallback(async (cmd: string) => {
    if (!cmd.trim()) return;

    const runtime = runtimeRef.current;
    if (!runtime) {
      setError('Workflow runtime is not initialized.');
      return;
    }

    setError(null);
    setStatusMessage('Processing...');

    const result = await runtime.runFromInput(cmd);
    syncRuntimeState(runtime);

    setStatusMessage(result.message);
    if (result.status === 'error' || result.status === 'blocked') {
      setError(result.message);
    }

    setInput('');
  }, [setStatusMessage, setInput, setError, syncRuntimeState]);

  // Initialize
  useEffect(() => {
    const runtime = createWorkflowRuntime({
      cwd,
      model,
    });
    runtimeRef.current = runtime;

    setCurrentModel(model);
    setSessionId(runtime.getRunId());
    setSessionStartedAt(new Date().toISOString());
    syncRuntimeState(runtime);
    setStatusMessage(`Ready | Model: ${model} | CWD: ${cwd} | Press Ctrl+C to exit`);

    // Set up command handler
    setOnSubmit((cmd: string) => {
      void handleCommand(cmd);
    });

    return () => {
      runtimeRef.current = null;
      setOnSubmit(undefined);
    };
  }, [
    model,
    cwd,
    setCurrentModel,
    setStatusMessage,
    setOnSubmit,
    setSessionId,
    setSessionStartedAt,
    syncRuntimeState,
    handleCommand,
  ]);

  // Global keyboard shortcuts
  useInput((inputKey, key) => {
    // Tab to switch panels
    if (key.tab) {
      const panels: Array<'chat' | 'files' | 'diff' | 'session'> = ['chat', 'files', 'diff', 'session'];
      const currentIndex = panels.indexOf(focusedPanel);
      const nextIndex = key.shift
        ? (currentIndex - 1 + panels.length) % panels.length
        : (currentIndex + 1) % panels.length;
      setFocusedPanel(panels[nextIndex]!);
    }

    // Escape to clear input
    if (key.escape) {
      setInput('');
      setError(null);
    }

    // Ctrl+Q to quit
    if (key.ctrl && inputKey === 'q') {
      exit();
    }
  }, { isActive: true });

  return (
    <Layout>
      <SplitLayout
        left={(
          <Panel title="Files" width="100%" focused={focusedPanel === 'files'}>
            <FileTree />
          </Panel>
        )}
        center={(
          <Box flexDirection="column" width="100%">
            <Panel title="Chat" width="100%" focused={focusedPanel === 'chat'}>
              <ChatPanel />
            </Panel>
            <Box paddingX={1}>
              <InputBar />
            </Box>
          </Box>
        )}
        right={(
          <Box flexDirection="column" width="100%">
            <Panel title="Session" width="100%" focused={focusedPanel === 'session'}>
              <SessionPanel />
            </Panel>
            <Panel title="Diff Preview" width="100%" focused={focusedPanel === 'diff'}>
              <DiffViewer />
            </Panel>
          </Box>
        )}
      />
    </Layout>
  );
}

/**
 * Start the Matrix TUI
 */
export async function startTUI(config: AppConfig): Promise<void> {
  const { waitUntilExit } = render(<MatrixApp {...config} />);
  await waitUntilExit();
}

/**
 * Run in headless mode
 */
export async function runHeadless(config: AppConfig): Promise<void> {
  const runtime = createWorkflowRuntime({
    cwd: config.cwd,
    model: config.model,
  });

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Matrix headless mode');
  console.log(`Run ID: ${runtime.getRunId()}`);
  console.log(`Model: ${config.model}`);
  console.log(`CWD: ${config.cwd}`);
  console.log('Type "exit" to quit.\n');

  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      await runtime.runFromInput('/stop');
      rl.close();
      return;
    }

    const result = await runtime.runFromInput(input);
    const latestAssistant = [...runtime.getMessages()]
      .reverse()
      .find((message) => message.role === 'assistant');

    if (latestAssistant) {
      console.log(`assistant> ${latestAssistant.content}\n`);
    } else {
      console.log(`status> ${result.message}\n`);
    }

    rl.prompt();
  });

  await new Promise<void>((resolve) => {
    rl.on('close', () => resolve());
  });
}

export default MatrixApp;
