import { describe, expect, it } from 'vitest';
import type { MCPServerRegistry } from './registry.js';
import { MCPClient } from './client.js';

function createRegistryStub() {
  return {
    getAllTools: () => [
      {
        name: 'read_repo',
        description: 'Read repository content',
        inputSchema: {},
        serverName: 'local',
      },
    ],
    getAllResources: () => [],
    getClient: () => undefined,
  } as unknown as MCPServerRegistry;
}

describe('MCPClient policy discipline', () => {
  it('emits policy.block when tool is denied', async () => {
    const policyBlocks: Array<{ rule: string; action: string; message: string }> = [];
    const client = new MCPClient(createRegistryStub(), {
      policyEventEmitter: {
        emit: async (_type, payload) => {
          policyBlocks.push(payload);
        },
      },
    });

    client.denyTool('read_repo');
    const result = await client.callTool('read_repo', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('denied');
    expect(policyBlocks).toHaveLength(1);
    expect(policyBlocks[0]?.rule).toBe('mcp_tool_permission');
    expect(policyBlocks[0]?.action).toBe('mcp.call_tool:read_repo');
  });

  it('emits policy.block when approval is required', async () => {
    const policyBlocks: Array<{ rule: string; action: string; message: string }> = [];
    const client = new MCPClient(createRegistryStub(), {
      policyEventEmitter: {
        emit: async (_type, payload) => {
          policyBlocks.push(payload);
        },
      },
    });

    const result = await client.callTool('read_repo', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires approval');
    expect(result.metadata?.requiresApproval).toBe(true);
    expect(policyBlocks).toHaveLength(1);
    expect(policyBlocks[0]?.rule).toBe('mcp_tool_permission');
  });
});
