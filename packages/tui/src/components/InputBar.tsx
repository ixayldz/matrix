import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../store.js';
import { COLORS } from './Layout.js';
import {
  executeCommand,
  getCommandSuggestions,
  getCommandNames,
  type CommandResult,
} from '../commands/index.js';

/**
 * Input bar component with slash command support
 */
export function InputBar() {
  const {
    input,
    setInput,
    isStreaming,
    currentModel,
    currentProvider,
    tokenUsage,
    workflowState,
    focusedPanel,
    setFocusedPanel,
    // Command context
    currentAgent,
    messages,
    modifiedFiles,
    pendingDiffs,
    setWorkflowState,
    setCurrentAgent,
    setCurrentModel,
    setCurrentProvider,
    clearMessages,
    setStatusMessage,
    setError,
    // Submit handler
    onSubmit,
  } = useStore();

  const [cursorPosition, setCursorPosition] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [commandResult, setCommandResult] = useState<CommandResult | null>(null);

  const truncateSingleLine = useCallback((value: string, maxChars = 90): string => {
    const singleLine = value.replace(/\r\n/g, '\n').split('\n')[0] ?? '';
    if (singleLine.length <= maxChars) {
      return singleLine;
    }
    if (maxChars <= 3) {
      return singleLine.slice(0, maxChars);
    }
    return `${singleLine.slice(0, maxChars - 3)}...`;
  }, []);

  // Update suggestions when input changes
  useEffect(() => {
    if (input.startsWith('/')) {
      const newSuggestions = getCommandSuggestions(input);
      setSuggestions(newSuggestions);
      setShowSuggestions(newSuggestions.length > 0);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, [input]);

  // Handle command execution
  const handleCommand = useCallback(async (cmd: string) => {
    const result = await executeCommand(cmd, {
      workflowState,
      currentAgent,
      currentModel,
      currentProvider,
      messages,
      modifiedFiles,
      pendingDiffs: pendingDiffs.map(d => ({ id: d.id, filePath: d.filePath, status: d.status })),
      setWorkflowState,
      setCurrentAgent,
      setCurrentModel,
      setCurrentProvider,
      clearMessages,
      setStatusMessage,
      setError,
    });

    setCommandResult(result);

    // Auto-clear result after 5 seconds
    setTimeout(() => setCommandResult(null), 5000);

    // Forward workflow commands to the orchestrator runtime.
    if (
      result.success &&
      result.action &&
      onSubmit &&
      ['new_session', 'start_plan', 'start_build', 'review_diff', 'start_qa', 'start_review', 'start_refactor', 'stop_agent', 'change_model', 'change_provider', 'open_auth_link'].includes(result.action)
    ) {
      onSubmit(cmd);
    }

    return result;
  }, [
    workflowState,
    currentAgent,
    currentModel,
    currentProvider,
    messages,
    modifiedFiles,
    pendingDiffs,
    setWorkflowState,
    setCurrentAgent,
    setCurrentModel,
    setCurrentProvider,
    clearMessages,
    setStatusMessage,
    setError,
    onSubmit,
  ]);

  // Handle input
  useInput((inputChar, key) => {
    // Handle command result dismissal
    if (commandResult && key.return) {
      setCommandResult(null);
      return;
    }

    if (focusedPanel !== 'chat') {
      // Tab to switch focus
      if (key.tab) {
        const panels: Array<'chat' | 'files' | 'diff' | 'session'> = ['chat', 'files', 'diff', 'session'];
        const currentIndex = panels.indexOf(focusedPanel as 'chat' | 'files' | 'diff' | 'session');
        const nextIndex = (currentIndex + 1) % panels.length;
        setFocusedPanel(panels[nextIndex]!);
      }
      return;
    }

    // Tab for autocomplete
    if (key.tab && showSuggestions && suggestions.length > 0) {
      const selected = suggestions[selectedSuggestion];
      if (selected) {
        setInput('/' + selected + ' ');
        setCursorPosition(selected.length + 2);
        setShowSuggestions(false);
      }
      return;
    }

    // Navigate suggestions
    if (showSuggestions) {
      if (key.upArrow) {
        setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion(Math.min(suggestions.length - 1, selectedSuggestion + 1));
        return;
      }
    }

    if (key.return) {
      // Check if it's a command
      if (input.trim().startsWith('/')) {
        handleCommand(input.trim());
        setInput('');
        setCursorPosition(0);
        setShowSuggestions(false);
      } else if (input.trim() && onSubmit) {
        // Regular message
        onSubmit(input.trim());
        setInput('');
        setCursorPosition(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        const newInput = input.slice(0, cursorPosition - 1) + input.slice(cursorPosition);
        setInput(newInput);
        setCursorPosition(cursorPosition - 1);
      }
      return;
    }

    if (key.leftArrow) {
      setCursorPosition(Math.max(0, cursorPosition - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPosition(Math.min(input.length, cursorPosition + 1));
      return;
    }

    // Regular character input
    if (!key.ctrl && !key.meta && inputChar) {
      const newInput = input.slice(0, cursorPosition) + inputChar + input.slice(cursorPosition);
      setInput(newInput);
      setCursorPosition(cursorPosition + 1);
    }
  });

  const inputHint = focusedPanel === 'chat'
    ? 'Type a message or /command'
    : 'Press Tab to focus chat input';

  const terminalColumns = process.stdout.columns ?? 120;
  const statusWidth = Math.max(24, terminalColumns - 16);
  const selectedSuggestionName = suggestions[selectedSuggestion];
  const suggestionLine = selectedSuggestionName
    ? `suggest: /${selectedSuggestionName}${suggestions.length > 1 ? ` (+${suggestions.length - 1})` : ''}`
    : '';
  const resultMessage = commandResult
    ? truncateSingleLine(commandResult.message || commandResult.error || '', statusWidth)
    : '';

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      minHeight={5}
      borderStyle="single"
      borderColor={COLORS.border}
    >
      {/* Info bar */}
      <Box justifyContent="space-between" paddingX={1}>
        <Box>
          <Text dimColor>Model: </Text>
          <Text color={COLORS.secondary}>{currentModel}</Text>
          <Text dimColor> | Provider: </Text>
          <Text color={COLORS.secondary}>{currentProvider}</Text>
          <Text dimColor> | State: </Text>
          <Text color={COLORS.warning}>{workflowState}</Text>
          {currentAgent && (
            <>
              <Text dimColor> | Agent: </Text>
              <Text color={COLORS.primary}>{currentAgent}</Text>
            </>
          )}
        </Box>
        <Box>
          <Text dimColor>Tokens: </Text>
          <Text>{tokenUsage.total.toLocaleString()}</Text>
        </Box>
      </Box>

      {/* Input area */}
      <Box paddingX={1}>
        <Text
          bold
          color={focusedPanel === 'chat' ? COLORS.primary : COLORS.textDim}
        >
          Input&gt;{' '}
        </Text>
        {input ? <Text>{input}</Text> : <Text dimColor>{inputHint}</Text>}
        {focusedPanel === 'chat' && !isStreaming && (
          <Text backgroundColor={COLORS.primary} color={COLORS.background}> </Text>
        )}
        {isStreaming && <Text dimColor> (waiting...)</Text>}
      </Box>

      <Box paddingX={1}>
        {commandResult ? (
          <Text color={commandResult.success ? COLORS.primary : COLORS.error}>
            {commandResult.success ? '[OK]' : '[X]'} {resultMessage}
          </Text>
        ) : showSuggestions && suggestionLine ? (
          <Text dimColor>{truncateSingleLine(suggestionLine, statusWidth)}</Text>
        ) : (
          <Text dimColor>ready</Text>
        )}
      </Box>

      {/* Help text */}
      <Box paddingX={1}>
        <Text dimColor>
          Tab/Shift+Tab: focus panel | Enter: send | Up/Down: scroll panel | Esc: clear
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Command input with autocomplete (standalone component)
 */
export function CommandInput({
  commands,
  onSubmit,
}: {
  commands: string[];
  onSubmit: (command: string) => void;
}) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (input.startsWith('/')) {
      const query = input.slice(1).toLowerCase();
      const filtered = commands.filter((cmd) =>
        cmd.toLowerCase().includes(query)
      );
      setSuggestions(filtered);
    } else {
      setSuggestions([]);
    }
  }, [input, commands]);

  useInput((inputChar, key) => {
    if (key.return) {
      if (suggestions.length > 0 && selectedIndex >= 0) {
        onSubmit('/' + suggestions[selectedIndex]!);
      } else if (input) {
        onSubmit(input);
      }
      setInput('');
      setSuggestions([]);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(suggestions.length - 1, selectedIndex + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setInput(input.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && inputChar) {
      setInput(input + inputChar);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={COLORS.primary}>&gt; </Text>
        <Text>{input}</Text>
        <Text backgroundColor={COLORS.primary}> </Text>
      </Box>

      {suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {suggestions.map((suggestion, index) => (
            <Text
              key={suggestion}
              color={index === selectedIndex ? COLORS.primary : COLORS.text}
              inverse={index === selectedIndex}
            >
              /{suggestion}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Get all command names (helper export)
 */
export { getCommandNames };
