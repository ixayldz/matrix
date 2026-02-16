import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { Message } from '@matrix/core';
import { COLORS } from './Layout.js';

interface ChatLine {
  key: string;
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

const ROLE_META: Record<string, { label: string; color: string }> = {
  system: { label: 'System', color: COLORS.textDim },
  user: { label: 'You', color: COLORS.primary },
  assistant: { label: 'Assistant', color: COLORS.secondary },
  tool: { label: 'Tool', color: COLORS.warning },
};

function truncateLine(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function toMessageLines(message: Message, index: number, maxChars: number): ChatLine[] {
  const meta = ROLE_META[message.role] ?? {
    label: message.role,
    color: COLORS.text,
  };
  const rows: ChatLine[] = [
    {
      key: `h-${index}`,
      text: `[${meta.label}]`,
      color: meta.color,
      bold: true,
    },
  ];

  const contentLines = message.content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < contentLines.length; i += 1) {
    const line = contentLines[i] ?? '';
    rows.push({
      key: `m-${index}-${i}`,
      text: `  ${truncateLine(line, maxChars)}`,
    });
  }

  rows.push({
    key: `sp-${index}`,
    text: ' ',
    dim: true,
  });

  return rows;
}

export function ChatPanel({ viewportRows = 14 }: { viewportRows?: number }) {
  const {
    messages,
    isStreaming,
    streamingContent,
    scrollOffsets,
    setScrollOffset,
  } = useStore();

  const rows = Math.max(6, viewportRows);
  const maxChars = Math.max(24, (process.stdout.columns ?? 120) - 20);
  const lines: ChatLine[] = messages.flatMap((message, index) =>
    toMessageLines(message, index, maxChars)
  );

  if (isStreaming && streamingContent) {
    lines.push({
      key: 'stream-h',
      text: '[Assistant] (streaming...)',
      color: COLORS.secondary,
      bold: true,
    });
    const streamingLines = streamingContent.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < streamingLines.length; i += 1) {
      const line = streamingLines[i] ?? '';
      lines.push({
        key: `stream-${i}`,
        text: `  ${truncateLine(line, maxChars)}`,
      });
    }
  }

  if (lines.length === 0) {
    lines.push({
      key: 'empty',
      text: 'No messages yet. Start with a requirement or /plan.',
      dim: true,
    });
  }

  const showIndicator = lines.length > rows;
  const contentRows = Math.max(3, rows - (showIndicator ? 1 : 0));
  const maxOffset = Math.max(0, lines.length - contentRows);
  const offsetRaw = scrollOffsets.chat;
  const offset = Math.min(maxOffset, Math.max(0, offsetRaw));

  useEffect(() => {
    if (offset !== offsetRaw) {
      setScrollOffset('chat', offset);
    }
  }, [offset, offsetRaw, setScrollOffset]);

  const startIndex = Math.max(0, lines.length - contentRows - offset);
  const visibleLines = lines.slice(startIndex, startIndex + contentRows);

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
            {line.text || ' '}
          </Text>
        ))}
      </Box>
      {showIndicator && (
        <Box justifyContent="center">
          <Text dimColor>
            chat {startIndex + 1}-{Math.min(lines.length, startIndex + contentRows)} / {lines.length} | offset {offset}/{maxOffset}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Event stream display
 */
export function EventStream() {
  const { messages } = useStore();

  return (
    <Box flexDirection="column" height="100%">
      <Text bold color={COLORS.primary}>Event Stream</Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.slice(-10).map((message, index) => (
          <Text key={index} wrap="truncate-end">
            {message.role}: {truncateLine(message.content, 80)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
