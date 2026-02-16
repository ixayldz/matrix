import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { MCPServerRegistry } from './registry.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempConfig(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'matrix-mcp-'));
  tempDirs.push(dir);
  const configPath = join(dir, 'mcp.json');
  await writeFile(configPath, JSON.stringify(content, null, 2), 'utf-8');
  return configPath;
}

describe('MCPServerRegistry.loadConfig', () => {
  it('loads object-map mcpServers format', async () => {
    const configPath = await createTempConfig({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          enabled: true,
        },
        memory: {
          command: 'node',
          args: ['memory-server.js'],
        },
      },
    });

    const registry = new MCPServerRegistry({ enabled: false });
    const result = await registry.loadConfig(configPath);

    expect(result).toEqual({ success: true, servers: 2 });
    expect(registry.getServer('filesystem')?.command).toBe('npx');
    expect(registry.getServer('memory')?.args).toEqual(['memory-server.js']);
  });

  it('loads array mcpServers format', async () => {
    const configPath = await createTempConfig({
      mcpServers: [
        {
          name: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      ],
    });

    const registry = new MCPServerRegistry({ enabled: false });
    const result = await registry.loadConfig(configPath);

    expect(result).toEqual({ success: true, servers: 1 });
    expect(registry.getServer('stdio')?.command).toBe('node');
  });

  it('rejects invalid mcpServers shape', async () => {
    const configPath = await createTempConfig({
      mcpServers: 'invalid',
    });

    const registry = new MCPServerRegistry({ enabled: false });
    const result = await registry.loadConfig(configPath);

    expect(result.success).toBe(false);
    expect(result.error).toContain('mcpServers');
  });
});
