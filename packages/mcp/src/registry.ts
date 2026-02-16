import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

/**
 * MCP Server status
 */
export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  error?: string;
}

/**
 * Audit log entry
 */
export interface MCPAuditEntry {
  id: string;
  timestamp: string;
  serverName: string;
  operation: 'connect' | 'disconnect' | 'call_tool' | 'read_resource' | 'list_tools' | 'list_resources';
  toolName?: string;
  resourceUri?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration: number;
  redacted: boolean;
}

/**
 * Audit log configuration
 */
export interface AuditConfig {
  enabled: boolean;
  logPath: string;
  maxEntries: number;
  redactSecrets: boolean;
  secretPatterns: RegExp[];
}

/**
 * Default audit configuration
 */
const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  enabled: true,
  logPath: join(homedir(), '.matrix', 'mcp-audit.jsonl'),
  maxEntries: 10000,
  redactSecrets: true,
  secretPatterns: [
    /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI keys
    /sk-ant-[a-zA-Z0-9-]{20,}/g,      // Anthropic keys
    /api[_-]?key['":\s]*['"][^'"]+['"]/gi,
    /secret['":\s]*['"][^'"]+['"]/gi,
    /bearer\s+[a-zA-Z0-9_-]+/gi,
    /password['":\s]*['"][^'"]+['"]/gi,
    /token['":\s]*['"][^'"]+['"]/gi,
  ],
};

/**
 * Connected server info
 */
interface ConnectedServer {
  config: MCPServerConfig;
  client: Client;
  transport: Transport;
  tools: MCPTool[];
  resources: MCPResource[];
}

/**
 * MCP Server Registry with Audit Logging
 *
 * Implements PRD Section 11 MCP requirements:
 * - Audit logging of all MCP operations
 * - Sensitive data redaction
 * - Config file loading from .matrix/mcp.json
 */
export class MCPServerRegistry {
  private servers: Map<string, MCPServerConfig>;
  private connected: Map<string, ConnectedServer>;
  private auditConfig: AuditConfig;
  private auditLog: MCPAuditEntry[] = [];

  constructor(auditConfig?: Partial<AuditConfig>) {
    this.servers = new Map();
    this.connected = new Map();
    this.auditConfig = { ...DEFAULT_AUDIT_CONFIG, ...auditConfig };
    this.loadAuditLog();
  }

  /**
   * Load existing audit log
   */
  private async loadAuditLog(): Promise<void> {
    if (!this.auditConfig.enabled) return;

    try {
      if (existsSync(this.auditConfig.logPath)) {
        const content = await readFile(this.auditConfig.logPath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l);
        this.auditLog = lines.map(line => JSON.parse(line) as MCPAuditEntry);
      }
    } catch {
      this.auditLog = [];
    }
  }

  /**
   * Save audit log entry
   */
  private async saveAuditEntry(entry: MCPAuditEntry): Promise<void> {
    if (!this.auditConfig.enabled) return;

    this.auditLog.push(entry);

    // Trim log if too large
    if (this.auditLog.length > this.auditConfig.maxEntries) {
      this.auditLog = this.auditLog.slice(-this.auditConfig.maxEntries);
    }

    try {
      const logDir = dirname(this.auditConfig.logPath);
      if (!existsSync(logDir)) {
        await mkdir(logDir, { recursive: true });
      }

      // Append to log file
      await writeFile(
        this.auditConfig.logPath,
        JSON.stringify(entry) + '\n',
        { flag: 'a' }
      );
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  /**
   * Redact sensitive data from value
   */
  private redactSensitive(value: unknown): { redacted: unknown; wasRedacted: boolean } {
    if (!this.auditConfig.redactSecrets) {
      return { redacted: value, wasRedacted: false };
    }

    if (typeof value === 'string') {
      let redacted = value;
      let wasRedacted = false;

      for (const pattern of this.auditConfig.secretPatterns) {
        const matches = value.match(pattern);
        if (matches) {
          wasRedacted = true;
          redacted = redacted.replace(pattern, '[REDACTED]');
        }
      }

      return { redacted, wasRedacted };
    }

    if (Array.isArray(value)) {
      const results = value.map(v => this.redactSensitive(v));
      return {
        redacted: results.map(r => r.redacted),
        wasRedacted: results.some(r => r.wasRedacted),
      };
    }

    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {};
      let wasRedacted = false;

      for (const [key, val] of Object.entries(value)) {
        const { redacted, wasRedacted: keyRedacted } = this.redactSensitive(val);
        result[key] = redacted;
        wasRedacted = wasRedacted || keyRedacted;

        // Also check key names for sensitive patterns
        const keyLower = key.toLowerCase();
        if (['password', 'secret', 'token', 'api_key', 'apikey', 'credential'].some(
          k => keyLower.includes(k)
        )) {
          result[key] = '[REDACTED]';
          wasRedacted = true;
        }
      }

      return { redacted: result, wasRedacted };
    }

    return { redacted: value, wasRedacted: false };
  }

  /**
   * Create audit entry
   */
  private createAuditEntry(
    serverName: string,
    operation: MCPAuditEntry['operation'],
    data: {
      toolName?: string;
      resourceUri?: string;
      arguments?: Record<string, unknown>;
      result?: unknown;
      error?: string;
      duration: number;
    }
  ): MCPAuditEntry {
    const { redacted: redactedArgs, wasRedacted: argsRedacted } =
      this.redactSensitive(data.arguments);
    const { redacted: redactedResult, wasRedacted: resultRedacted } =
      this.redactSensitive(data.result);
    const safeArgs = (
      redactedArgs &&
      typeof redactedArgs === 'object' &&
      !Array.isArray(redactedArgs)
    )
      ? redactedArgs as Record<string, unknown>
      : undefined;

    const entry: MCPAuditEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      serverName,
      operation,
      ...(data.toolName !== undefined ? { toolName: data.toolName } : {}),
      ...(data.resourceUri !== undefined ? { resourceUri: data.resourceUri } : {}),
      ...(safeArgs !== undefined ? { arguments: safeArgs } : {}),
      result: redactedResult,
      ...(data.error !== undefined ? { error: data.error } : {}),
      duration: data.duration,
      redacted: argsRedacted || resultRedacted,
    };

    this.saveAuditEntry(entry);
    return entry;
  }

  /**
   * Load MCP configuration from file
   */
  async loadConfig(configPath: string): Promise<{ success: boolean; servers: number; error?: string }> {
    try {
      const resolvedPath = configPath.startsWith('~')
        ? join(homedir(), configPath.slice(1))
        : configPath;

      if (!existsSync(resolvedPath)) {
        return { success: false, servers: 0, error: `Config file not found: ${resolvedPath}` };
      }

      const content = await readFile(resolvedPath, 'utf-8');
      const config = JSON.parse(content);

      const rawServers = config?.mcpServers;
      if (!rawServers || (typeof rawServers !== 'object' && !Array.isArray(rawServers))) {
        return {
          success: false,
          servers: 0,
          error: 'Invalid config: mcpServers must be an array or object map',
        };
      }

      const normalizedServers: MCPServerConfig[] = [];
      if (Array.isArray(rawServers)) {
        for (const serverConfig of rawServers) {
          if (!serverConfig || typeof serverConfig !== 'object') {
            continue;
          }
          const cfg = serverConfig as Partial<MCPServerConfig>;
          if (!cfg.name || !cfg.command) {
            continue;
          }
          const normalized: MCPServerConfig = {
            name: cfg.name,
            command: cfg.command,
            args: Array.isArray(cfg.args) ? cfg.args : [],
            enabled: cfg.enabled ?? true,
            ...(cfg.env && typeof cfg.env === 'object' ? { env: cfg.env } : {}),
            ...(typeof cfg.timeout === 'number' ? { timeout: cfg.timeout } : {}),
          };
          normalizedServers.push(normalized);
        }
      } else {
        for (const [name, serverConfig] of Object.entries(rawServers as Record<string, unknown>)) {
          if (!serverConfig || typeof serverConfig !== 'object') {
            continue;
          }
          const cfg = serverConfig as Partial<MCPServerConfig>;
          if (!cfg.command) {
            continue;
          }
          const normalized: MCPServerConfig = {
            name,
            command: cfg.command,
            args: Array.isArray(cfg.args) ? cfg.args : [],
            enabled: cfg.enabled ?? true,
            ...(cfg.env && typeof cfg.env === 'object' ? { env: cfg.env } : {}),
            ...(typeof cfg.timeout === 'number' ? { timeout: cfg.timeout } : {}),
          };
          normalizedServers.push(normalized);
        }
      }

      let serverCount = 0;
      for (const serverConfig of normalizedServers) {
        if (serverConfig.name && serverConfig.command) {
          this.register(serverConfig);
          serverCount++;
        }
      }

      return { success: true, servers: serverCount };
    } catch (error) {
      return {
        success: false,
        servers: 0,
        error: error instanceof Error ? error.message : 'Failed to load config',
      };
    }
  }

  /**
   * Register a server
   */
  register(config: MCPServerConfig): void {
    this.servers.set(config.name, {
      ...config,
      enabled: config.enabled ?? true,
    });
  }

  /**
   * Unregister a server
   */
  unregister(name: string): boolean {
    this.servers.delete(name);
    this.disconnect(name);
    return true;
  }

  /**
   * Get server config
   */
  getServer(name: string): MCPServerConfig | undefined {
    return this.servers.get(name);
  }

  /**
   * List all registered servers
   */
  listServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Connect to a server
   */
  async connect(name: string): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    const config = this.servers.get(name);
    if (!config) {
      this.createAuditEntry(name, 'connect', {
        error: `Server ${name} not found`,
        duration: Date.now() - startTime,
      });
      return { success: false, error: `Server ${name} not found` };
    }

    if (!config.enabled) {
      this.createAuditEntry(name, 'connect', {
        error: `Server ${name} is disabled`,
        duration: Date.now() - startTime,
      });
      return { success: false, error: `Server ${name} is disabled` };
    }

    // Disconnect if already connected
    if (this.connected.has(name)) {
      await this.disconnect(name);
    }

    try {
      const baseEnv = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );
      const mergedEnv = config.env ? { ...baseEnv, ...config.env } : baseEnv;

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: mergedEnv,
      });

      const client = new Client(
        { name: 'matrix-cli', version: '0.1.0' },
        { capabilities: {} }
      );

      await client.connect(transport);

      // Get available tools
      const tools: MCPTool[] = [];
      const resources: MCPResource[] = [];

      try {
        const toolsResult = await client.listTools();
        for (const tool of toolsResult.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema as Record<string, unknown>,
            serverName: name,
          });
        }

        // Audit tool listing
        this.createAuditEntry(name, 'list_tools', {
          result: { count: tools.length, tools: tools.map(t => t.name) },
          duration: 0,
        });
      } catch {
        // Server doesn't support tools
      }

      try {
        const resourcesResult = await client.listResources();
        for (const resource of resourcesResult.resources) {
          resources.push({
            uri: resource.uri,
            name: resource.name,
            serverName: name,
            ...(resource.description !== undefined ? { description: resource.description } : {}),
            ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
          });
        }

        // Audit resource listing
        this.createAuditEntry(name, 'list_resources', {
          result: { count: resources.length },
          duration: 0,
        });
      } catch {
        // Server doesn't support resources
      }

      this.connected.set(name, {
        config,
        client,
        transport,
        tools,
        resources,
      });

      // Audit successful connection
      this.createAuditEntry(name, 'connect', {
        result: { toolCount: tools.length, resourceCount: resources.length },
        duration: Date.now() - startTime,
      });

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection failed';

      // Audit failed connection
      this.createAuditEntry(name, 'connect', {
        error: errorMsg,
        duration: Date.now() - startTime,
      });

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Connect to all registered servers
   */
  async connectAll(): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();

    for (const [name, config] of this.servers) {
      if (config.enabled) {
        results.set(name, await this.connect(name));
      }
    }

    return results;
  }

  /**
   * Disconnect from a server
   */
  async disconnect(name: string): Promise<boolean> {
    const startTime = Date.now();
    const server = this.connected.get(name);
    if (!server) {
      return false;
    }

    try {
      await server.client.close();

      // Audit successful disconnect
      this.createAuditEntry(name, 'disconnect', {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      // Audit failed disconnect
      this.createAuditEntry(name, 'disconnect', {
        error: error instanceof Error ? error.message : 'Disconnect failed',
        duration: Date.now() - startTime,
      });
    }

    this.connected.delete(name);
    return true;
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    for (const name of this.connected.keys()) {
      await this.disconnect(name);
    }
  }

  /**
   * Check if connected to a server
   */
  isConnected(name: string): boolean {
    return this.connected.has(name);
  }

  /**
   * Get client for a server
   */
  getClient(name: string): Client | undefined {
    return this.connected.get(name)?.client;
  }

  /**
   * Get all tools from all connected servers
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const server of this.connected.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  /**
   * Get all resources from all connected servers
   */
  getAllResources(): MCPResource[] {
    const resources: MCPResource[] = [];
    for (const server of this.connected.values()) {
      resources.push(...server.resources);
    }
    return resources;
  }

  /**
   * Get server status
   */
  getStatus(name: string): MCPServerStatus | null {
    const config = this.servers.get(name);
    if (!config) {
      return null;
    }

    const connected = this.connected.get(name);
    return {
      name,
      connected: !!connected,
      toolCount: connected?.tools.length ?? 0,
      resourceCount: connected?.resources.length ?? 0,
    };
  }

  /**
   * Get all server statuses
   */
  getAllStatuses(): MCPServerStatus[] {
    const statuses: MCPServerStatus[] = [];

    for (const [name, config] of this.servers) {
      const connected = this.connected.get(name);
      statuses.push({
        name,
        connected: !!connected,
        toolCount: connected?.tools.length ?? 0,
        resourceCount: connected?.resources.length ?? 0,
        ...(config.enabled && !connected ? { error: 'Not connected' } : {}),
      });
    }

    return statuses;
  }

  /**
   * Get audit log
   */
  getAuditLog(options?: {
    serverName?: string;
    operation?: MCPAuditEntry['operation'];
    limit?: number;
  }): MCPAuditEntry[] {
    let entries = [...this.auditLog];

    if (options?.serverName) {
      entries = entries.filter(e => e.serverName === options.serverName);
    }

    if (options?.operation) {
      entries = entries.filter(e => e.operation === options.operation);
    }

    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Clear audit log
   */
  async clearAuditLog(): Promise<void> {
    this.auditLog = [];
    if (existsSync(this.auditConfig.logPath)) {
      await writeFile(this.auditConfig.logPath, '');
    }
  }

  /**
   * Export audit log to file
   */
  async exportAuditLog(outputPath: string): Promise<{ success: boolean; entries: number }> {
    try {
      const content = this.auditLog.map(e => JSON.stringify(e)).join('\n');
      await writeFile(outputPath, content);
      return { success: true, entries: this.auditLog.length };
    } catch {
      return { success: false, entries: 0 };
    }
  }
}

/**
 * Create an MCP Server Registry
 */
export function createMCPServerRegistry(auditConfig?: Partial<AuditConfig>): MCPServerRegistry {
  return new MCPServerRegistry(auditConfig);
}
