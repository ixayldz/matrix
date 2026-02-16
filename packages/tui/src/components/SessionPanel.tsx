import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import { COLORS, Panel } from './Layout.js';

/**
 * Task item component
 */
function TaskItem({
  title,
  status,
  isActive,
}: {
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  isActive: boolean;
}) {
  const statusIcons: Record<'pending' | 'in_progress' | 'completed' | 'blocked', string> = {
    pending: '○',
    in_progress: '◐',
    completed: '●',
    blocked: '✗',
  };

  const statusColors: Record<'pending' | 'in_progress' | 'completed' | 'blocked', string> = {
    pending: COLORS.textDim,
    in_progress: COLORS.warning,
    completed: COLORS.primary,
    blocked: COLORS.error,
  };

  return (
    <Box flexDirection="row">
      <Text color={statusColors[status]}>
        {isActive ? '▶ ' : '  '}
        {statusIcons[status]}
      </Text>
      <Text
        color={isActive ? COLORS.primary : COLORS.text}
        bold={isActive}
      >
        {' '}{title.slice(0, 18)}{title.length > 18 ? '...' : ''}
      </Text>
    </Box>
  );
}

/**
 * Agent status indicator
 */
function AgentStatus({
  agent,
  status,
  currentTask,
}: {
  agent: string;
  status: 'idle' | 'active' | 'waiting';
  currentTask?: string;
}) {
  const statusColors: Record<'idle' | 'active' | 'waiting', string> = {
    idle: COLORS.textDim,
    active: COLORS.primary,
    waiting: COLORS.warning,
  };

  const statusLabels: Record<'idle' | 'active' | 'waiting', string> = {
    idle: 'Idle',
    active: 'Active',
    waiting: 'Waiting',
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={COLORS.secondary}>{agent}</Text>
        <Text color={statusColors[status]}> [{statusLabels[status]}]</Text>
      </Box>
      {currentTask && (
        <Text dimColor>  → {currentTask.slice(0, 25)}...</Text>
      )}
    </Box>
  );
}

/**
 * Session info component
 */
function SessionInfo({
  sessionId,
  startedAt,
  runCount,
}: {
  sessionId: string;
  startedAt: string;
  runCount: number;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={COLORS.primary}>Session</Text>
      <Text dimColor>  ID: {sessionId.slice(0, 8)}...</Text>
      <Text dimColor>  Started: {startedAt}</Text>
      <Text dimColor>  Turns: {runCount}</Text>
    </Box>
  );
}

/**
 * Session panel component - PRD Section 4.5
 * Left panel with session info, agent state, and task list
 */
export function SessionPanel() {
  const {
    workflowState,
    currentAgent,
    focusedPanel,
    messages,
    sessionId,
    sessionStartedAt,
  } = useStore();

  // Session data from runtime
  const session = {
    id: sessionId ?? 'not-started',
    startedAt: sessionStartedAt
      ? new Date(sessionStartedAt).toLocaleTimeString()
      : 'n/a',
    runCount: messages.filter((message) => message.role === 'user').length,
  };

  // Mock agent states
  const agents: Array<{ name: string; status: 'idle' | 'active' | 'waiting' }> = [
    { name: 'Plan Agent', status: currentAgent === 'plan_agent' ? 'active' : 'idle' },
    { name: 'Builder Agent', status: currentAgent === 'builder_agent' ? 'active' : 'idle' },
    { name: 'QA Agent', status: currentAgent === 'qa_agent' ? 'active' : 'idle' },
    { name: 'Review Agent', status: currentAgent === 'review_agent' ? 'active' : 'idle' },
    { name: 'Refactor Agent', status: currentAgent === 'refactor_agent' ? 'active' : 'idle' },
  ];

  const tasks: Array<{ id: string; title: string; status: 'pending' | 'in_progress' | 'completed' | 'blocked' }> = [
    {
      id: 'plan',
      title: 'Plan requirements',
      status: ['PRD_INTAKE', 'PRD_CLARIFYING', 'PLAN_DRAFTED', 'AWAITING_PLAN_CONFIRMATION'].includes(workflowState)
        ? 'in_progress'
        : 'completed',
    },
    {
      id: 'build',
      title: 'Implement changes',
      status: workflowState === 'IMPLEMENTING'
        ? 'in_progress'
        : ['QA', 'REVIEW', 'REFACTOR', 'DONE'].includes(workflowState)
          ? 'completed'
          : 'pending',
    },
    {
      id: 'qa',
      title: 'Run QA',
      status: workflowState === 'QA'
        ? 'in_progress'
        : ['REVIEW', 'REFACTOR', 'DONE'].includes(workflowState)
          ? 'completed'
          : 'pending',
    },
    {
      id: 'review',
      title: 'Review and refactor',
      status: ['REVIEW', 'REFACTOR'].includes(workflowState)
        ? 'in_progress'
        : workflowState === 'DONE'
          ? 'completed'
          : 'pending',
    },
  ];

  const isFocused = focusedPanel === 'session';

  return (
    <Panel title="Session" width="100%" focused={isFocused}>
      {/* Session Info */}
      <SessionInfo
        sessionId={session.id}
        startedAt={session.startedAt}
        runCount={session.runCount}
      />

      {/* Divider */}
      <Box borderStyle="single" borderColor={COLORS.border} />

      {/* Agent States */}
      <Box flexDirection="column" marginY={1}>
        <Text bold color={COLORS.primary}>Agents</Text>
        {agents.map((agent) => (
          <AgentStatus
            key={agent.name}
            agent={agent.name}
            status={agent.status}
          />
        ))}
      </Box>

      {/* Divider */}
      <Box borderStyle="single" borderColor={COLORS.border} />

      {/* Task List */}
      <Box flexDirection="column" marginY={1}>
        <Text bold color={COLORS.primary}>Tasks</Text>
        {tasks.map((task, index) => (
          <TaskItem
            key={task.id}
            title={task.title}
            status={task.status}
            isActive={index === tasks.findIndex((entry) => entry.status === 'in_progress')}
          />
        ))}
      </Box>

      {/* Workflow State */}
      <Box marginTop={1}>
        <Text dimColor>State: </Text>
        <Text color={COLORS.warning}>{workflowState}</Text>
      </Box>
    </Panel>
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
