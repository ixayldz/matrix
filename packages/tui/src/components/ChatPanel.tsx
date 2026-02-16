import { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { Message } from '@matrix/core';
import { COLORS } from './Layout.js';

/**
 * Render a single message
 */
function MessageBubble({ message }: { message: Message }) {
  const roleColors: Record<string, string> = {
    system: COLORS.textDim,
    user: COLORS.primary,       // Neon green for user
    assistant: COLORS.secondary, // Blue for assistant
    tool: COLORS.warning,        // Gold for tool
  };

  const roleLabels: Record<string, string> = {
    system: 'System',
    user: 'You',
    assistant: 'Assistant',
    tool: 'Tool',
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={roleColors[message.role] || COLORS.text}>
          [{roleLabels[message.role] || message.role}]
        </Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <MessageContent content={message.content} />
      </Box>
    </Box>
  );
}

/**
 * Render message content with code block support
 */
function MessageContent({ content }: { content: string }) {
  // Simple code block detection
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          // Code block
          const lines = part.slice(3, -3).split('\n');
          const language = lines[0] || '';
          const code = lines.slice(1).join('\n');

          return (
            <Box key={index} flexDirection="column" marginY={1}>
              {language && (
                <Text dimColor backgroundColor={COLORS.border}>
                  {language}
                </Text>
              )}
              <Text color={COLORS.primary}>{code}</Text>
            </Box>
          );
        }

        // Regular text
        return (
          <Text key={index}>{part}</Text>
        );
      })}
    </>
  );
}

/**
 * Chat panel component
 */
export function ChatPanel() {
  const { messages, isStreaming, streamingContent } = useStore();
  const scrollRef = useRef<number>(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current = messages.length;
  }, [messages.length]);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.slice(-20).map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}

        {/* Streaming content */}
        {isStreaming && streamingContent && (
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color={COLORS.secondary}>[Assistant]</Text>
              <Text dimColor> (streaming...)</Text>
            </Box>
            <Box marginLeft={2}>
              <Text>{streamingContent}</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Scroll indicator */}
      {messages.length > 20 && (
        <Box justifyContent="center">
          <Text dimColor>
            Showing last 20 of {messages.length} messages
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
          <Box key={index}>
            <Text dimColor>
              [{new Date().toLocaleTimeString()}]
            </Text>
            <Text> {message.role}: {message.content.slice(0, 50)}...</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
