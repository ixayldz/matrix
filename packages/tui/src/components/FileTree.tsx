import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { FileNode } from '@matrix/context-engine';

interface FlatFileNode {
  path: string;
  name: string;
  depth: number;
  type: FileNode['type'];
}

function flattenTree(node: FileNode, depth = 0): FlatFileNode[] {
  const rows: FlatFileNode[] = [
    {
      path: node.path,
      name: node.name,
      depth,
      type: node.type,
    },
  ];
  if (node.children?.length) {
    for (const child of node.children) {
      rows.push(...flattenTree(child, depth + 1));
    }
  }
  return rows;
}

/**
 * Single file tree item
 */
function FileTreeItem({
  node,
  isSelected = false,
  isModified = false,
}: {
  node: FlatFileNode;
  isSelected?: boolean;
  isModified?: boolean;
}) {
  const indent = '  '.repeat(node.depth);
  const icon = node.type === 'directory' ? '[D]' : '[F]';

  return (
    <Box>
      <Text dimColor>{indent}</Text>
      <Text
        wrap="truncate-end"
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
  viewportRows = 12,
}: {
  structure?: FileNode;
  modifiedFiles?: string[];
  viewportRows?: number;
}) {
  const { selectedFile, scrollOffsets, setScrollOffset } = useStore();
  const rows = Math.max(4, viewportRows);
  const flatRows = structure ? flattenTree(structure) : [];
  const showCount = flatRows.length > rows;
  const showModified = modifiedFiles.length > 0;
  const footerRows = (showCount ? 1 : 0) + (showModified ? 1 : 0);
  const contentRows = Math.max(2, rows - footerRows);
  const maxOffset = Math.max(0, flatRows.length - contentRows);
  const offsetRaw = scrollOffsets.files;
  const offset = Math.min(maxOffset, Math.max(0, offsetRaw));

  useEffect(() => {
    if (offset !== offsetRaw) {
      setScrollOffset('files', offset);
    }
  }, [offset, offsetRaw, setScrollOffset]);

  if (!structure) {
    return (
      <Box flexDirection="column">
        <Text dimColor>No files loaded</Text>
      </Box>
    );
  }

  const visibleRows = flatRows.slice(offset, offset + contentRows);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleRows.map((row) => (
          <FileTreeItem
            key={row.path}
            node={row}
            isSelected={selectedFile === row.path}
            isModified={modifiedFiles.includes(row.path)}
          />
        ))}
      </Box>
      {showCount && (
        <Text dimColor>
          files {offset + 1}-{Math.min(flatRows.length, offset + contentRows)} / {flatRows.length}
        </Text>
      )}
      {showModified && (
        <Text dimColor>{modifiedFiles.length} modified</Text>
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
