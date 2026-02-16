import type { MCPServerRegistry, MCPTool } from './registry.js';
import type { ToolResult } from '@matrix/core';

/**
 * Lightweight policy.block bridge payload.
 */
export interface MCPPolicyBlockPayload {
  rule: string;
  message: string;
  action: string;
  context?: Record<string, unknown>;
}

/**
 * Optional emitter interface for policy.block integration.
 */
export interface MCPPolicyEventEmitter {
  emit: (type: 'policy.block', payload: MCPPolicyBlockPayload) => Promise<unknown> | unknown;
}

/**
 * Tool call options
 */
export interface ToolCallOptions {
  serverName?: string;
  timeout?: number;
}

/**
 * MCP client options.
 */
export interface MCPClientOptions {
  policyEventEmitter?: MCPPolicyEventEmitter;
}

/**
 * MCP Client wrapper for Matrix CLI
 */
export class MCPClient {
  private registry: MCPServerRegistry;
  private allowedTools: Set<string>;
  private deniedTools: Set<string>;
  private policyEventEmitter: MCPPolicyEventEmitter | undefined;

  constructor(registry: MCPServerRegistry, options: MCPClientOptions = {}) {
    this.registry = registry;
    this.allowedTools = new Set();
    this.deniedTools = new Set();
    this.policyEventEmitter = options.policyEventEmitter;
  }

  private async emitPolicyBlock(payload: MCPPolicyBlockPayload): Promise<void> {
    if (!this.policyEventEmitter) {
      return;
    }

    try {
      await this.policyEventEmitter.emit('policy.block', payload);
    } catch {
      // Best-effort emission to avoid breaking MCP calls due telemetry/event failures.
    }
  }

  /**
   * Call an MCP tool
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: ToolCallOptions = {}
  ): Promise<ToolResult> {
    // Find the tool
    const tool = this.findTool(name, options.serverName);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${name} not found`,
      };
    }

    // Check if tool is denied
    if (this.deniedTools.has(name)) {
      await this.emitPolicyBlock({
        rule: 'mcp_tool_permission',
        message: `MCP tool ${name} is denied by policy.`,
        action: `mcp.call_tool:${name}`,
        context: {
          serverName: tool.serverName,
        },
      });
      return {
        success: false,
        error: `Tool ${name} is denied`,
      };
    }

    // Check if tool needs approval
    if (!this.allowedTools.has(name)) {
      await this.emitPolicyBlock({
        rule: 'mcp_tool_permission',
        message: `MCP tool ${name} requires approval before execution.`,
        action: `mcp.call_tool:${name}`,
        context: {
          serverName: tool.serverName,
          requiresApproval: true,
        },
      });
      return {
        success: false,
        error: `Tool ${name} requires approval`,
        metadata: { requiresApproval: true },
      };
    }

    // Get client
    const client = this.registry.getClient(tool.serverName);
    if (!client) {
      return {
        success: false,
        error: `Server ${tool.serverName} not connected`,
      };
    }

    try {
      const result = await client.callTool({
        name: tool.name,
        arguments: args,
      });

      const content = result.content;
      const isError = result.isError ?? false;

      // Extract text content
      let output = '';
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text') {
            output += item.text;
          }
        }
      }

      const toolResult: ToolResult = {
        success: !isError,
        data: output,
      };
      if (isError) {
        toolResult.error = output;
      }
      return toolResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool call failed',
      };
    }
  }

  /**
   * Allow a tool
   */
  allowTool(name: string): void {
    this.allowedTools.add(name);
    this.deniedTools.delete(name);
  }

  /**
   * Deny a tool
   */
  denyTool(name: string): void {
    this.deniedTools.add(name);
    this.allowedTools.delete(name);
  }

  /**
   * Check if tool is allowed
   */
  isToolAllowed(name: string): boolean {
    return this.allowedTools.has(name);
  }

  /**
   * Check if tool is denied
   */
  isToolDenied(name: string): boolean {
    return this.deniedTools.has(name);
  }

  /**
   * Get all available tools
   */
  getAvailableTools(): MCPTool[] {
    return this.registry.getAllTools();
  }

  /**
   * Find a tool by name
   */
  private findTool(name: string, serverName?: string): MCPTool | undefined {
    const tools = this.registry.getAllTools();

    if (serverName) {
      return tools.find(t => t.name === name && t.serverName === serverName);
    }

    return tools.find(t => t.name === name);
  }

  /**
   * Read an MCP resource
   */
  async readResource(uri: string): Promise<ToolResult> {
    // Find the resource
    const resources = this.registry.getAllResources();
    const resource = resources.find(r => r.uri === uri);

    if (!resource) {
      return {
        success: false,
        error: `Resource ${uri} not found`,
      };
    }

    // Get client
    const client = this.registry.getClient(resource.serverName);
    if (!client) {
      return {
        success: false,
        error: `Server ${resource.serverName} not connected`,
      };
    }

    try {
      const result = await client.readResource({ uri });

      const contents = result.contents;
      let output = '';

      if (Array.isArray(contents)) {
        for (const item of contents) {
          if ('text' in item) {
            output += item.text;
          } else if ('blob' in item) {
            output += `[Binary data: ${item.blob.length} bytes]`;
          }
        }
      }

      return {
        success: true,
        data: output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Resource read failed',
      };
    }
  }
}

/**
 * Create an MCP Client
 */
export function createMCPClient(registry: MCPServerRegistry, options: MCPClientOptions = {}): MCPClient {
  return new MCPClient(registry, options);
}
