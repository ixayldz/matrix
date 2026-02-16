import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { FileNode } from '@matrix/context-engine';

/**
 * Single file tree item
 */
function FileTreeItem({
  node,
  depth = 0,
  isSelected = false,
  isModified = false,
}: {
  node: FileNode;
  depth?: number;
  isSelected?: boolean;
  isModified?: boolean;
}) {
  const indent = '  '.repeat(depth);
  const icon = node.type === 'directory' ? '📁' : '📄';

  return (
    <Box>
      <Text dimColor>{indent}</Text>
      <Text
        color={isSelected ? 'cyan' : isModified ? 'yellow' : 'white'}
        bold={isSelected}
        inverse={isSelected}
      >
        {icon} {node.name}
      </Text>
      {isModified && <Text color="yellow"> *</Text>}
    </Box>
  );
}

/**
 * File tree component
 */
export function FileTree({
  structure,
  modifiedFiles = [],
}: {
  structure?: FileNode;
  modifiedFiles?: string[];
}) {
  const { selectedFile, focusedPanel } = useStore();
  const isFocused = focusedPanel === 'files';

  if (!structure) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No files loaded</Text>
      </Box>
    );
  }

  const renderNode = (node: FileNode, depth = 0): React.ReactNode => {
    const isModified = modifiedFiles.includes(node.path);
    const isSelected = selectedFile === node.path;

    return (
      <Box key={node.path} flexDirection="column">
        <FileTreeItem
          node={node}
          depth={depth}
          isSelected={isSelected}
          isModified={isModified}
        />
        {node.children?.map((child) => renderNode(child, depth + 1))}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      <Text bold color={isFocused ? 'cyan' : 'white'}>
        Files
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {renderNode(structure)}
      </Box>
      {modifiedFiles.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>{modifiedFiles.length} modified</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * File list component (simpler than tree)
 */
export function FileList({
  files,
  selectedFile,
}: {
  files: string[];
  selectedFile?: string | null;
}) {
  return (
    <Box flexDirection="column" height="100%">
      <Text bold>Files</Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {files.slice(0, 30).map((file) => {
          const fileName = file.split('/').pop() ?? file;
          const isSelected = selectedFile === file;

          return (
            <Box key={file}>
              <Text
                color={isSelected ? 'cyan' : 'white'}
                bold={isSelected}
                inverse={isSelected}
              >
                {fileName}
              </Text>
            </Box>
          );
        })}
        {files.length > 30 && (
          <Text dimColor>... {files.length - 30} more</Text>
        )}
      </Box>
    </Box>
  );
}
