import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';

/**
 * PRD Section 4.5 - Color Scheme
 * Primary: Neon green (#00FF41)
 * Background: Dark grey/black
 */
export const COLORS = {
  primary: '#00FF41',      // Neon green
  primaryDim: '#00CC33',   // Dimmed neon green
  secondary: '#00BFFF',    // Deep sky blue for accents
  warning: '#FFD700',      // Gold for warnings
  error: '#FF3333',        // Red for errors
  background: '#1A1A1A',   // Dark grey
  border: '#333333',       // Border grey
  text: '#CCCCCC',         // Light grey text
  textDim: '#666666',      // Dimmed text
};

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * Main layout component with three-panel design
 */
export function Layout({ children }: LayoutProps) {
  const { workflowState, currentAgent, statusMessage, error } = useStore();

  return (
    <Box flexDirection="column" height="100%" width="100%">
      {/* Header */}
      <Box
        borderStyle="single"
        borderColor={COLORS.primary}
        paddingX={1}
        justifyContent="space-between"
      >
        <Text bold color={COLORS.primary}>
          Matrix CLI v0.1
        </Text>
        <Text dimColor>
          State: <Text color={COLORS.warning}>{workflowState}</Text>
          {currentAgent && (
            <Text> | Agent: <Text color={COLORS.secondary}>{currentAgent}</Text></Text>
          )}
        </Text>
      </Box>

      {/* Main content area */}
      <Box flexGrow={1} flexDirection="row">
        {children}
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" borderColor={COLORS.border} paddingX={1}>
        <Text dimColor>
          {error ? (
            <Text color={COLORS.error}>{error}</Text>
          ) : (
            statusMessage
          )}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Panel component
 */
export function Panel({
  title,
  children,
  width,
  focused = false,
}: {
  title: string;
  children: React.ReactNode;
  width: string | number;
  focused?: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      height="100%"
      borderStyle="single"
      borderColor={focused ? COLORS.primary : COLORS.border}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={focused ? COLORS.primary : COLORS.text}>
          {title}
        </Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

/**
 * Split panel layout
 */
export function SplitLayout({
  left,
  center,
  right,
  leftWidth = 26,
  rightWidth = 34,
}: {
  left?: React.ReactNode;
  center: React.ReactNode;
  right?: React.ReactNode;
  leftWidth?: number;
  rightWidth?: number;
}) {
  const hasLeft = Boolean(left);
  const hasRight = Boolean(right);

  return (
    <Box flexDirection="row" width="100%" height="100%">
      {hasLeft && (
        <Box width={leftWidth} minWidth={20} flexShrink={0} marginRight={1}>
          {left}
        </Box>
      )}
      <Box flexGrow={1} minWidth={40}>
        {center}
      </Box>
      {hasRight && (
        <Box width={rightWidth} minWidth={24} flexShrink={0} marginLeft={1}>
          {right}
        </Box>
      )}
    </Box>
  );
}
