import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import { COLORS } from './Layout.js';

interface SessionLine {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * Session panel component - single-layer content renderer.
 */
export function SessionPanel({ viewportRows = 10 }: { viewportRows?: number }) {
  const {
    workflowState,
    currentAgent,
    messages,
    sessionId,
    sessionStartedAt,
    scrollOffsets,
    setScrollOffset,
  } = useStore();

  const session = {
    id: sessionId ?? 'not-started',
    startedAt: sessionStartedAt
      ? new Date(sessionStartedAt).toLocaleTimeString()
      : 'n/a',
    runCount: messages.filter((message) => message.role === 'user').length,
  };

  const agents: Array<{ name: string; status: 'idle' | 'active' }> = [
    { name: 'Plan Agent', status: currentAgent === 'plan_agent' ? 'active' : 'idle' },
    { name: 'Builder Agent', status: currentAgent === 'builder_agent' ? 'active' : 'idle' },
    { name: 'QA Agent', status: currentAgent === 'qa_agent' ? 'active' : 'idle' },
    { name: 'Review Agent', status: currentAgent === 'review_agent' ? 'active' : 'idle' },
    { name: 'Refactor Agent', status: currentAgent === 'refactor_agent' ? 'active' : 'idle' },
  ];

  const tasks: Array<{ title: string; status: 'pending' | 'in_progress' | 'completed' }> = [
    {
      title: 'Plan requirements',
      status: ['PRD_INTAKE', 'PRD_CLARIFYING', 'PLAN_DRAFTED', 'AWAITING_PLAN_CONFIRMATION'].includes(workflowState)
        ? 'in_progress'
        : 'completed',
    },
    {
      title: 'Implement changes',
      status: workflowState === 'IMPLEMENTING'
        ? 'in_progress'
        : ['QA', 'REVIEW', 'REFACTOR', 'DONE'].includes(workflowState)
          ? 'completed'
          : 'pending',
    },
    {
      title: 'Run QA',
      status: workflowState === 'QA'
        ? 'in_progress'
        : ['REVIEW', 'REFACTOR', 'DONE'].includes(workflowState)
          ? 'completed'
          : 'pending',
    },
    {
      title: 'Review and refactor',
      status: ['REVIEW', 'REFACTOR'].includes(workflowState)
        ? 'in_progress'
        : workflowState === 'DONE'
          ? 'completed'
          : 'pending',
    },
  ];

  const taskIcon: Record<'pending' | 'in_progress' | 'completed', string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[*]',
  };
  const taskColor: Record<'pending' | 'in_progress' | 'completed', string> = {
    pending: COLORS.textDim,
    in_progress: COLORS.warning,
    completed: COLORS.primary,
  };

  const lines: SessionLine[] = [
    { text: 'Session', bold: true, color: COLORS.primary },
    { text: `ID: ${session.id.slice(0, 8)}...`, dim: true },
    { text: `Started: ${session.startedAt}`, dim: true },
    { text: `Turns: ${session.runCount}`, dim: true },
    { text: '------------------------', dim: true },
    { text: 'Agents', bold: true, color: COLORS.primary },
    ...agents.map((agent) => ({
      text: `${agent.status === 'active' ? '>' : ' '} [A] ${agent.name} (${agent.status})`,
      color: agent.status === 'active' ? COLORS.primary : COLORS.text,
    })),
    { text: '------------------------', dim: true },
    { text: 'Tasks', bold: true, color: COLORS.primary },
    ...tasks.map((task) => ({
      text: `${taskIcon[task.status]} ${task.title}`,
      color: taskColor[task.status],
    })),
    { text: `State: ${workflowState}`, color: COLORS.warning },
  ];

  const rows = Math.max(6, viewportRows);
  const showIndicator = lines.length > rows;
  const contentRows = Math.max(3, rows - (showIndicator ? 1 : 0));
  const maxOffset = Math.max(0, lines.length - contentRows);
  const offsetRaw = scrollOffsets.session;
  const offset = Math.min(maxOffset, Math.max(0, offsetRaw));

  useEffect(() => {
    if (offset !== offsetRaw) {
      setScrollOffset('session', offset);
    }
  }, [offset, offsetRaw, setScrollOffset]);

  const visibleLines = lines.slice(offset, offset + contentRows);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.map((line, index) => (
          <Text
            key={`${line.text}-${index}`}
            wrap="truncate-end"
            {...(line.color ? { color: line.color } : {})}
            {...(line.bold ? { bold: true } : {})}
            {...(line.dim ? { dimColor: true } : {})}
          >
            {line.text}
          </Text>
        ))}
      </Box>
      {showIndicator && (
        <Text dimColor>
          session {offset + 1}-{Math.min(lines.length, offset + contentRows)} / {lines.length}
        </Text>
      )}
    </Box>
  );
}

/**
 * Mini session panel for compact view
 */
export function MiniSessionPanel() {
  const { workflowState, currentAgent } = useStore();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={COLORS.primary}>Matrix</Text>
      <Text dimColor>State: <Text color={COLORS.warning}>{workflowState}</Text></Text>
      {currentAgent && (
        <Text dimColor>Agent: <Text color={COLORS.secondary}>{currentAgent}</Text></Text>
      )}
    </Box>
  );
}
