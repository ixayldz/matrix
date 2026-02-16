import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { DiffHunk } from '@matrix/core';

/**
 * Single diff hunk display
 */
function DiffHunkView({ hunk, index }: { hunk: DiffHunk; index: number }) {
  const lines = hunk.content.split('\n');
  const status = hunk.status ?? 'pending';
  const statusColor = status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'yellow';

  return (
    <Box flexDirection="column" key={index}>
      <Text dimColor>
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        <Text color={statusColor}> [{status}]</Text>
      </Text>
      {lines.slice(0, 20).map((line, lineIndex) => {
        let color = 'white';
        let prefix = ' ';

        if (line.startsWith('+')) {
          color = 'green';
          prefix = '+';
        } else if (line.startsWith('-')) {
          color = 'red';
          prefix = '-';
        }

        return (
          <Text key={lineIndex} color={color}>
            {prefix}{line}
          </Text>
        );
      })}
      {lines.length > 20 && (
        <Text dimColor>... {lines.length - 20} more lines</Text>
      )}
    </Box>
  );
}

/**
 * Diff viewer component
 */
export function DiffViewer() {
  const { pendingDiffs, focusedPanel } = useStore();
  const isFocused = focusedPanel === 'diff';
  const reviewQueue = pendingDiffs.filter((diff) =>
    diff.hunks.some((hunk) => (hunk.status ?? 'pending') === 'pending')
  );

  if (pendingDiffs.length === 0) {
    return (
      <Box flexDirection="column" height="100%">
        <Text dimColor>No pending diffs</Text>
      </Box>
    );
  }

  const currentDiff = reviewQueue[0] ?? pendingDiffs[0];

  if (!currentDiff) {
    return null;
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Diff header */}
      <Box marginBottom={1}>
        <Text bold color={isFocused ? 'cyan' : 'white'}>
          Diff: {currentDiff.filePath}
        </Text>
        <Text dimColor> ({reviewQueue.length} pending review)</Text>
      </Box>

      {/* Diff stats */}
      <Box marginBottom={1}>
        <Text color="green">+{currentDiff.hunks.reduce((acc, h) => acc + h.newLines, 0)}</Text>
        <Text> </Text>
        <Text color="red">-{currentDiff.hunks.reduce((acc, h) => acc + h.oldLines, 0)}</Text>
      </Box>

      {/* Diff hunks */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {currentDiff.hunks.map((hunk, index) => (
          <DiffHunkView key={index} hunk={hunk} index={index} />
        ))}
      </Box>

      {/* Approval controls */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Actions:</Text>
        <Text color="green">/diff approve all</Text>
        <Text color="green">/diff approve 1,2</Text>
        <Text color="red">/diff reject all</Text>
        <Text color="red">/diff reject 2</Text>
      </Box>
    </Box>
  );
}

/**
 * Mini diff preview for file list
 */
export function DiffPreview({ hunks }: { hunks: DiffHunk[] }) {
  const additions = hunks.reduce((acc, h) => acc + h.newLines, 0);
  const deletions = hunks.reduce((acc, h) => acc + h.oldLines, 0);

  return (
    <Box>
      <Text color="green">+{additions}</Text>
      <Text> </Text>
      <Text color="red">-{deletions}</Text>
    </Box>
  );
}
