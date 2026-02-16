import { useEffect, useCallback, useMemo, useRef } from 'react';
import { render, Box, useApp, useInput } from 'ink';
import { Layout, SplitLayout, Panel } from './components/Layout.js';
import { ChatPanel } from './components/ChatPanel.js';
import { FileTree } from './components/FileTree.js';
import { DiffViewer } from './components/DiffViewer.js';
import { InputBar } from './components/InputBar.js';
import { SessionPanel } from './components/SessionPanel.js';
import { useStore } from './store.js';
import { createWorkflowRuntime, type WorkflowRuntime } from './runtime/workflow-runtime.js';
import {
  inferProviderFromModel,
  getProviderAuthSnapshot,
  isProviderName,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_LOGIN_URL,
  type ProviderName,
} from './auth/provider-auth.js';
import { openExternalUrl } from './platform/open-url.js';

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

function normalizeProvider(provider: string | undefined, modelName: string) {
  if (!provider) {
    return inferProviderFromModel(modelName);
  }

  const normalized = provider.toLowerCase();
  if (isProviderName(normalized)) {
    return normalized;
  }

  return inferProviderFromModel(modelName);
}

function parseAuthProviderArgument(input: string): ProviderName | null {
  const parts = input.trim().split(/\s+/);
  const candidate = parts[2]?.toLowerCase();
  return isProviderName(candidate) ? candidate : null;
}

function parseDirectProviderArgument(input: string): ProviderName | null {
  const parts = input.trim().split(/\s+/);
  const candidate = parts[1]?.toLowerCase();
  return isProviderName(candidate) ? candidate : null;
}

/**
 * Main Matrix TUI App component
 */
export function MatrixApp({ cwd, model, provider }: AppConfig) {
  const { exit } = useApp();
  const runtimeRef = useRef<WorkflowRuntime | null>(null);
  const {
    input,
    currentModel,
    currentProvider,
    setInput,
    setOnSubmit,
    focusedPanel,
    scrollBy,
    setCurrentModel,
    setCurrentProvider,
    setStatusMessage,
    setError,
    setWorkflowState,
    setMessages,
    setPendingDiffs,
    setCurrentAgent,
    setSessionId,
    setSessionStartedAt,
    addMessage,
  } = useStore();

  const viewport = useMemo(() => {
    const terminalHeight = process.stdout.rows ?? 24;
    const contentRows = Math.max(10, terminalHeight - 16);
    const rightRows = Math.max(8, contentRows - 2);
    const rightEach = Math.max(4, Math.floor(rightRows / 2));
    return {
      files: Math.max(6, contentRows),
      chat: Math.max(6, Math.floor(contentRows * 0.6)),
      session: rightEach,
      diff: rightEach,
    };
  }, []);

  const syncRuntimeState = useCallback((runtime: WorkflowRuntime) => {
    setWorkflowState(runtime.getState());
    setMessages(runtime.getMessages());
    setPendingDiffs(runtime.getPendingDiffs());
    setCurrentAgent(runtime.getCurrentAgent());
  }, [setWorkflowState, setMessages, setPendingDiffs, setCurrentAgent]);

  // Handle user input through orchestrator runtime
  const handleCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) {
      return;
    }

    if (/^\/new(\s|$)/.test(trimmed)) {
      const runtime = createWorkflowRuntime({
        cwd,
        model: currentModel,
        provider: currentProvider,
      });
      runtimeRef.current = runtime;
      setSessionId(runtime.getRunId());
      setSessionStartedAt(new Date().toISOString());
      syncRuntimeState(runtime);
      setError(null);
      setStatusMessage(`New session started | Model: ${currentModel} | Provider: ${currentProvider} | CWD: ${cwd}`);

      const authSnapshot = await getProviderAuthSnapshot(currentProvider);
      if (!authSnapshot.isAuthenticated) {
        const loginUrl = PROVIDER_LOGIN_URL[currentProvider];
        const openResult = await openExternalUrl(loginUrl);
        addMessage({
          role: 'assistant',
          content: [
            `Provider auth required for "${currentProvider}".`,
            openResult.success ? `Browser opened: ${loginUrl}` : `Open this link: ${loginUrl}`,
            `Then run: /auth set ${currentProvider} <API_KEY>`,
            `For persistent secure storage you can also run: matrix auth add ${currentProvider} --key "<API_KEY>"`,
          ].join('\n'),
        });
        setStatusMessage(openResult.success
          ? `Auth required for ${currentProvider}. Login page opened.`
          : `Auth required for ${currentProvider}. Login link shared in chat.`);
      }

      setInput('');
      return;
    }

    if (trimmed.startsWith('/model ')) {
      const requestedModel = trimmed.split(/\s+/)[1];
      const runtime = runtimeRef.current;
      if (!requestedModel) {
        setError('Model name is required. Usage: /model <model-name>');
        return;
      }
      if (!runtime) {
        setError('Workflow runtime is not initialized.');
        return;
      }

      runtime.setModel(requestedModel);
      syncRuntimeState(runtime);
      setError(null);
      setStatusMessage(`Model updated: ${requestedModel}`);
      setInput('');
      return;
    }

    if (/^\/auth\s+use\s+/i.test(trimmed)) {
      const runtime = runtimeRef.current;
      const targetProvider = parseAuthProviderArgument(trimmed) ?? currentProvider;
      const targetModel = PROVIDER_DEFAULT_MODEL[targetProvider];
      if (runtime) {
        runtime.setModel(targetModel);
        syncRuntimeState(runtime);
      }

      const snapshot = await getProviderAuthSnapshot(targetProvider);
      if (!snapshot.isAuthenticated) {
        const loginUrl = PROVIDER_LOGIN_URL[targetProvider];
        const openResult = await openExternalUrl(loginUrl);
        addMessage({
          role: 'assistant',
          content: [
            `Provider switched to "${targetProvider}" with model "${targetModel}".`,
            openResult.success ? `Browser opened: ${loginUrl}` : `Login link: ${loginUrl}`,
            `After login, run: /auth set ${targetProvider} <API_KEY>`,
          ].join('\n'),
        });
        setStatusMessage(openResult.success
          ? `Provider switched to ${targetProvider}. Login page opened.`
          : `Provider switched to ${targetProvider}. Missing API key.`);
      } else {
        setStatusMessage(`Provider/model switched | Provider: ${targetProvider} | Model: ${targetModel}`);
      }

      setError(null);
      setInput('');
      return;
    }

    if (/^\/auth\s+(login|link)\b/i.test(trimmed) || /^\/(login|link)\b/i.test(trimmed)) {
      const targetProvider = /^\/auth\s+/i.test(trimmed)
        ? (parseAuthProviderArgument(trimmed) ?? currentProvider)
        : (parseDirectProviderArgument(trimmed) ?? currentProvider);
      const loginUrl = PROVIDER_LOGIN_URL[targetProvider];
      const openResult = await openExternalUrl(loginUrl);
      addMessage({
        role: 'assistant',
        content: openResult.success
          ? `Opened ${targetProvider} login page in your browser:\n${loginUrl}\nAfter generating an API key, run:\n/auth set ${targetProvider} <API_KEY>`
          : `Could not open browser automatically.\nOpen this link manually:\n${loginUrl}\nThen run:\n/auth set ${targetProvider} <API_KEY>`,
      });

      setError(openResult.success ? null : (openResult.error ?? null));
      setStatusMessage(openResult.success
        ? `${targetProvider} login page opened.`
        : `${targetProvider} login link shared in chat.`);
      setInput('');
      return;
    }

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
  }, [
    cwd,
    currentModel,
    currentProvider,
    setStatusMessage,
    setInput,
    setError,
    syncRuntimeState,
    setSessionId,
    setSessionStartedAt,
    addMessage,
  ]);

  // Initialize
  useEffect(() => {
    const initialProvider = normalizeProvider(provider, model);
    const runtime = createWorkflowRuntime({
      cwd,
      model,
      provider: initialProvider,
    });
    runtimeRef.current = runtime;

    setCurrentModel(model);
    setCurrentProvider(initialProvider);
    setSessionId(runtime.getRunId());
    setSessionStartedAt(new Date().toISOString());
    syncRuntimeState(runtime);
    setStatusMessage(`Ready | Model: ${model} | Provider: ${initialProvider} | CWD: ${cwd} | Press Ctrl+C to exit`);

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
    provider,
    cwd,
    setCurrentModel,
    setCurrentProvider,
    setStatusMessage,
    setOnSubmit,
    setSessionId,
    setSessionStartedAt,
    syncRuntimeState,
    handleCommand,
  ]);

  // Global keyboard shortcuts
  useInput((inputKey, key) => {
    // Escape to clear input
    if (key.escape) {
      setInput('');
      setError(null);
    }

    // Ctrl+Q to quit
    if (key.ctrl && inputKey === 'q') {
      exit();
      return;
    }

    if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
      // Keep slash-command suggestion navigation stable while typing commands in chat.
      if (focusedPanel === 'chat' && input.startsWith('/')) {
        return;
      }

      let delta = 0;
      if (key.upArrow) {
        delta = focusedPanel === 'chat' ? 1 : -1;
      } else if (key.downArrow) {
        delta = focusedPanel === 'chat' ? -1 : 1;
      } else if (key.pageUp) {
        delta = focusedPanel === 'chat' ? 5 : -5;
      } else if (key.pageDown) {
        delta = focusedPanel === 'chat' ? -5 : 5;
      }

      if (delta !== 0) {
        scrollBy(focusedPanel, delta);
      }
    }
  }, { isActive: true });

  return (
    <Layout>
      <SplitLayout
        left={(
          <Box height="100%" width="100%">
            <Panel title="Files" width="100%" focused={focusedPanel === 'files'}>
              <FileTree viewportRows={viewport.files} />
            </Panel>
          </Box>
        )}
        center={(
          <Box flexDirection="column" width="100%" height="100%">
            <Box flexGrow={1} minHeight={8}>
              <Panel title="Chat" width="100%" focused={focusedPanel === 'chat'}>
                <ChatPanel viewportRows={viewport.chat} />
              </Panel>
            </Box>
            <Box flexShrink={0}>
              <InputBar />
            </Box>
          </Box>
        )}
        right={(
          <Box flexDirection="column" width="100%" height="100%">
            <Box flexGrow={1}>
              <Panel title="Session" width="100%" focused={focusedPanel === 'session'}>
                <SessionPanel viewportRows={viewport.session} />
              </Panel>
            </Box>
            <Box flexGrow={1}>
              <Panel title="Diff Preview" width="100%" focused={focusedPanel === 'diff'}>
                <DiffViewer viewportRows={viewport.diff} />
              </Panel>
            </Box>
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
    ...(config.provider ? { provider: config.provider } : {}),
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
