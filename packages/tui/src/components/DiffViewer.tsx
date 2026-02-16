import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { DiffHunk } from '@matrix/core';

interface DiffLine {
  key: string;
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

function truncateLine(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

export function DiffViewer({ viewportRows = 8 }: { viewportRows?: number }) {
  const { pendingDiffs, focusedPanel, scrollOffsets, setScrollOffset } = useStore();
  const isFocused = focusedPanel === 'diff';
  const reviewQueue = pendingDiffs.filter((diff) =>
    diff.hunks.some((hunk) => (hunk.status ?? 'pending') === 'pending')
  );
  const currentDiff = reviewQueue[0] ?? pendingDiffs[0] ?? null;
  const rows = Math.max(6, viewportRows);
  const maxChars = Math.max(24, (process.stdout.columns ?? 120) - 24);
  const lines: DiffLine[] = [];

  if (currentDiff) {
    const additions = currentDiff.hunks.reduce((acc, h) => acc + h.newLines, 0);
    const deletions = currentDiff.hunks.reduce((acc, h) => acc + h.oldLines, 0);
    lines.push(
      {
        key: 'summary-1',
        text: truncateLine(currentDiff.filePath, maxChars),
        color: isFocused ? 'cyan' : 'white',
        bold: true,
      },
      {
        key: 'summary-2',
        text: `+${additions} -${deletions} | pending queue: ${reviewQueue.length}`,
        dim: true,
      }
    );

    currentDiff.hunks.forEach((hunk, index) => {
      const status = hunk.status ?? 'pending';
      const statusColor = status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'yellow';
      const marker = status === 'approved' ? '[+]' : status === 'rejected' ? '[-]' : '[ ]';
      lines.push({
        key: `h-${index}`,
        text: `${marker} #${index + 1} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} [${status}]`,
        color: statusColor,
      });

      const previewLine = hunk.content
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (previewLine) {
        lines.push({
          key: `p-${index}`,
          text: `    ${truncateLine(previewLine, maxChars)}`,
          dim: true,
        });
      }
    });

    lines.push({
      key: 'hint',
      text: 'Use: /diff approve all | /diff approve 1,2 | /diff reject all',
      dim: true,
    });
  }

  const showIndicator = lines.length > rows;
  const contentRows = Math.max(3, rows - (showIndicator ? 1 : 0));
  const maxOffset = Math.max(0, lines.length - contentRows);
  const offsetRaw = scrollOffsets.diff;
  const offset = Math.min(maxOffset, Math.max(0, offsetRaw));

  useEffect(() => {
    if (offset !== offsetRaw) {
      setScrollOffset('diff', offset);
    }
  }, [offset, offsetRaw, setScrollOffset]);

  if (pendingDiffs.length === 0) {
    return (
      <Box flexDirection="column" height="100%">
        <Text dimColor>No pending diffs</Text>
      </Box>
    );
  }

  if (!currentDiff) {
    return (
      <Box flexDirection="column" height="100%">
        <Text dimColor>No diff selected</Text>
      </Box>
    );
  }

  const visibleLines = lines.slice(offset, offset + contentRows);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.map((line) => (
          <Text
            key={line.key}
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
          diff {offset + 1}-{Math.min(lines.length, offset + contentRows)} / {lines.length}
        </Text>
      )}
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
