/**
 * TUI Slash Commands - PRD Section 4.1
 *
 * Commands are organized into categories:
 * - Session: /new, /resume, /fork, /export, /import, /clear
 * - Project & Context: /init, /status, /context, /context find, /context explain, /rules
 * - Agent & Workflow: /plan, /build, /diff, /qa, /review, /refactor, /stop
 * - Model / Auth: /model, /auth, /quota, /telemetry
 * - Tool / MCP: /tools, /mcp, /approval, /sandbox
 */

import type { WorkflowState, AgentType } from '@matrix/core';

/**
 * Command result
 */
export interface CommandResult {
  success: boolean;
  status?: 'success' | 'blocked' | 'needs_input' | 'error';
  message?: string;
  error?: string;
  action?: CommandAction;
  data?: Record<string, unknown>;
}

/**
 * Actions that can be triggered by commands
 */
export type CommandAction =
  | 'new_session'
  | 'resume_session'
  | 'fork_session'
  | 'export_session'
  | 'import_session'
  | 'clear_chat'
  | 'init_project'
  | 'show_status'
  | 'find_context'
  | 'explain_context'
  | 'manage_context_policy'
  | 'show_rules'
  | 'start_plan'
  | 'start_build'
  | 'review_diff'
  | 'start_qa'
  | 'start_review'
  | 'start_refactor'
  | 'stop_agent'
  | 'change_model'
  | 'show_auth'
  | 'show_quota'
  | 'set_telemetry'
  | 'show_tools'
  | 'show_mcp'
  | 'set_approval'
  | 'set_sandbox';

/**
 * Command definition
 */
export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: 'session' | 'project' | 'agent' | 'model' | 'tool';
  requiresArg?: boolean;
  handler: (args: string[], context: CommandContext) => CommandResult | Promise<CommandResult>;
}

/**
 * Command context - provides access to TUI state and actions
 */
export interface CommandContext {
  workflowState: WorkflowState;
  currentAgent: AgentType | null;
  currentModel: string;
  messages: Array<{ role: string; content: string }>;
  modifiedFiles: string[];
  pendingDiffs: Array<{
    id: string;
    filePath: string;
    status?: 'pending' | 'approved' | 'rejected' | 'applied' | 'rolled_back';
  }>;

  // Actions
  setWorkflowState: (state: WorkflowState) => void;
  setCurrentAgent: (agent: AgentType | null) => void;
  setCurrentModel: (model: string) => void;
  clearMessages: () => void;
  setStatusMessage: (message: string) => void;
  setError: (error: string | null) => void;
}

/**
 * All available commands
 */
export const COMMANDS: CommandDefinition[] = [
  // Session Commands
  {
    name: 'new',
    description: 'Start a new session',
    category: 'session',
    handler: (_args, context) => {
      context.clearMessages();
      context.setWorkflowState('PRD_INTAKE');
      context.setCurrentAgent(null);
      return {
        success: true,
        message: 'New session started',
        action: 'new_session',
      };
    },
  },
  {
    name: 'resume',
    aliases: ['continue'],
    description: 'Resume a previous session',
    usage: '/resume [session-id]',
    category: 'session',
    handler: (args, _context) => {
      const sessionId = args[0];
      if (!sessionId) {
        return {
          success: false,
          error: 'Session ID required. Usage: /resume <session-id>',
        };
      }
      return {
        success: true,
        message: `Resuming session: ${sessionId}`,
        action: 'resume_session',
        data: { sessionId },
      };
    },
  },
  {
    name: 'fork',
    description: 'Fork current session to a new branch',
    usage: '/fork [branch-name]',
    category: 'session',
    handler: (args, _context) => {
      const branchName = args[0] || `fork-${Date.now()}`;
      return {
        success: true,
        message: `Session forked to: ${branchName}`,
        action: 'fork_session',
        data: { branchName },
      };
    },
  },
  {
    name: 'export',
    description: 'Export current session to file',
    usage: '/export [filename]',
    category: 'session',
    handler: (args, _context) => {
      const filename = args[0] || `session-${Date.now()}.json`;
      return {
        success: true,
        message: `Session exported to: ${filename}`,
        action: 'export_session',
        data: { filename },
      };
    },
  },
  {
    name: 'import',
    description: 'Import a session from file',
    usage: '/import <filename>',
    category: 'session',
    requiresArg: true,
    handler: (args, _context) => {
      const filename = args[0];
      if (!filename) {
        return {
          success: false,
          error: 'Filename required. Usage: /import <filename>',
        };
      }
      return {
        success: true,
        message: `Session imported from: ${filename}`,
        action: 'import_session',
        data: { filename },
      };
    },
  },
  {
    name: 'clear',
    description: 'Clear chat messages',
    category: 'session',
    handler: (_args, context) => {
      context.clearMessages();
      return {
        success: true,
        message: 'Chat cleared',
        action: 'clear_chat',
      };
    },
  },

  // Project & Context Commands
  {
    name: 'init',
    description: 'Initialize Matrix in current project',
    category: 'project',
    handler: (_args, _context) => {
      return {
        success: true,
        message: 'Initializing .matrix directory...',
        action: 'init_project',
      };
    },
  },
  {
    name: 'status',
    description: 'Show project and session status',
    category: 'project',
    handler: (_args, context) => {
      return {
        success: true,
        message: `Status:
  State: ${context.workflowState}
  Agent: ${context.currentAgent || 'none'}
  Model: ${context.currentModel}
  Messages: ${context.messages.length}
  Modified Files: ${context.modifiedFiles.length}
  Pending Diffs: ${context.pendingDiffs.length}`,
        action: 'show_status',
        data: {
          workflowState: context.workflowState,
          currentAgent: context.currentAgent,
          currentModel: context.currentModel,
          messageCount: context.messages.length,
          modifiedFilesCount: context.modifiedFiles.length,
          pendingDiffsCount: context.pendingDiffs.length,
        },
      };
    },
  },
  {
    name: 'context',
    description: 'Context management commands',
    usage: '/context [find|explain] [query]',
    category: 'project',
    handler: (args, _context) => {
      const subCommand = args[0];

      if (subCommand === 'find') {
        const query = args.slice(1).join(' ');
        if (!query) {
          return {
            success: false,
            error: 'Query required. Usage: /context find <query>',
          };
        }
        return {
          success: true,
          message: `Searching context for: ${query}`,
          action: 'find_context',
          data: { query },
        };
      }

      if (subCommand === 'explain') {
        const query = args.slice(1).join(' ');
        if (!query) {
          return {
            success: false,
            error: 'Query required. Usage: /context explain <query>',
          };
        }
        return {
          success: true,
          message: `Explaining: ${query}`,
          action: 'explain_context',
          data: { query },
        };
      }

      if (subCommand === 'policy') {
        const mode = args[1]?.toLowerCase();
        const validModes = ['auto', 'strict', 'minimal'];

        if (!mode) {
          return {
            success: true,
            message: `Context Policy:
  - auto: Balanced retrieval and token budget management (default)
  - strict: Aggressive pruning + tighter token budget
  - minimal: Only essential files and symbols

Usage: /context policy <auto|strict|minimal>`,
            action: 'manage_context_policy',
            data: { mode: 'auto' },
          };
        }

        if (!validModes.includes(mode)) {
          return {
            success: false,
            error: `Invalid context policy: ${mode}. Valid modes: ${validModes.join(', ')}`,
          };
        }

        return {
          success: true,
          message: `Context policy set to: ${mode}`,
          action: 'manage_context_policy',
          data: { mode },
        };
      }

      return {
        success: true,
        message: `Context:
  - /context find <query> - Search codebase context
  - /context explain <query> - Explain code/feature
  - /context policy <mode> - Manage context retrieval policy`,
      };
    },
  },
  {
    name: 'rules',
    description: 'Show project rules and conventions',
    category: 'project',
    handler: (_args, _context) => {
      return {
        success: true,
        message: 'Loading project rules from CLAUDE.md and .matrix/config.json...',
        action: 'show_rules',
      };
    },
  },

  // Agent & Workflow Commands
  {
    name: 'plan',
    description: 'Switch to Plan Agent for requirement analysis',
    usage: '/plan [approve|revise|deny]',
    category: 'agent',
    handler: (args, context) => {
      const subCommand = args[0]?.toLowerCase();

      if (subCommand === 'approve') {
        if (context.workflowState !== 'AWAITING_PLAN_CONFIRMATION') {
          return {
            success: false,
            status: 'blocked',
            error: `Cannot approve plan from state: ${context.workflowState}`,
          };
        }
        context.setCurrentAgent('builder_agent');
        context.setWorkflowState('IMPLEMENTING');
        return {
          success: true,
          status: 'success',
          message: 'Plan approved. Builder Agent activated.',
          action: 'start_build',
        };
      }

      if (subCommand === 'revise') {
        if (context.workflowState !== 'AWAITING_PLAN_CONFIRMATION') {
          return {
            success: false,
            status: 'blocked',
            error: `Cannot revise plan from state: ${context.workflowState}`,
          };
        }
        context.setCurrentAgent('plan_agent');
        context.setWorkflowState('PLAN_DRAFTED');
        return {
          success: true,
          status: 'success',
          message: 'Plan revision requested. Plan Agent activated.',
          action: 'start_plan',
        };
      }

      if (subCommand === 'deny') {
        if (context.workflowState !== 'AWAITING_PLAN_CONFIRMATION') {
          return {
            success: false,
            status: 'blocked',
            error: `Cannot deny plan from state: ${context.workflowState}`,
          };
        }
        context.setCurrentAgent('plan_agent');
        context.setWorkflowState('PLAN_DRAFTED');
        return {
          success: true,
          status: 'success',
          message: 'Plan denied. You can request a revised plan.',
          action: 'start_plan',
        };
      }

      if (!['PRD_INTAKE', 'PRD_CLARIFYING', 'PLAN_DRAFTED', 'DONE'].includes(context.workflowState)) {
        return {
          success: false,
          status: 'blocked',
          error: `Cannot start Plan Agent from state: ${context.workflowState}`,
        };
      }
      context.setCurrentAgent('plan_agent');
      context.setWorkflowState('PRD_INTAKE');
      return {
        success: true,
        status: 'success',
        message: 'Plan Agent activated. Describe your requirements.',
        action: 'start_plan',
      };
    },
  },
  {
    name: 'build',
    description: 'Switch to Builder Agent for implementation',
    category: 'agent',
    handler: (_args, context) => {
      if (context.workflowState === 'AWAITING_PLAN_CONFIRMATION') {
        return {
          success: false,
          status: 'needs_input',
          error: 'Plan approval required before implementation. Use natural language approval or /plan approve.',
        };
      }

      if (context.workflowState !== 'IMPLEMENTING') {
        return {
          success: false,
          status: 'blocked',
          error: `Cannot start Builder Agent from state: ${context.workflowState}. Approve a plan first.`,
        };
      }
      context.setCurrentAgent('builder_agent');
      context.setWorkflowState('IMPLEMENTING');
      return {
        success: true,
        status: 'success',
        message: 'Builder Agent activated. Starting implementation...',
        action: 'start_build',
      };
    },
  },
  {
    name: 'diff',
    description: 'Approve or reject pending diff hunks',
    usage: '/diff <approve|reject> [all|1,2]',
    category: 'agent',
    handler: (args, context) => {
      if (!['IMPLEMENTING', 'QA'].includes(context.workflowState)) {
        return {
          success: false,
          status: 'blocked',
          error: `Cannot review diffs from state: ${context.workflowState}`,
        };
      }

      const decision = args[0]?.toLowerCase();
      if (!decision || !['approve', 'reject'].includes(decision)) {
        return {
          success: false,
          status: 'needs_input',
          error: 'Usage: /diff <approve|reject> [all|indexes]',
        };
      }

      const hasPendingDiff = context.pendingDiffs.some((diff) => (diff.status ?? 'pending') === 'pending');
      if (!hasPendingDiff) {
        return {
          success: false,
          status: 'blocked',
          error: 'No pending diffs to review.',
        };
      }

      return {
        success: true,
        status: 'success',
        message: `Diff ${decision} request queued.`,
        action: 'review_diff',
        data: {
          decision,
          selection: args.slice(1).join(' ') || 'all',
        },
      };
    },
  },
  {
    name: 'qa',
    description: 'Switch to QA Agent for testing',
    category: 'agent',
    handler: (_args, context) => {
      const hasPendingDiff = context.pendingDiffs.some((diff) => (diff.status ?? 'pending') === 'pending');
      if (hasPendingDiff) {
        return {
          success: false,
          status: 'needs_input',
          error: 'Resolve pending diffs before QA. Use /diff approve [all|indexes] or /diff reject [all|indexes].',
        };
      }

      const hasAppliedDiff = context.pendingDiffs.some(
        (diff) => (diff.status ?? 'pending') === 'applied' || (diff.status ?? 'pending') === 'approved'
      );
      if (!hasAppliedDiff) {
        return {
          success: false,
          status: 'blocked',
          error: 'At least one approved diff hunk must be applied before QA can run.',
        };
      }

      if (!['IMPLEMENTING', 'QA'].includes(context.workflowState)) {
        return {
          success: false,
          error: `Cannot start QA Agent from state: ${context.workflowState}`,
        };
      }
      context.setCurrentAgent('qa_agent');
      context.setWorkflowState('QA');
      return {
        success: true,
        message: 'QA Agent activated. Running tests...',
        action: 'start_qa',
      };
    },
  },
  {
    name: 'review',
    description: 'Switch to Review Agent for code review',
    category: 'agent',
    handler: (_args, context) => {
      if (!['QA', 'REVIEW', 'IMPLEMENTING'].includes(context.workflowState)) {
        return {
          success: false,
          error: `Cannot start Review Agent from state: ${context.workflowState}`,
        };
      }
      context.setCurrentAgent('review_agent');
      context.setWorkflowState('REVIEW');
      return {
        success: true,
        message: 'Review Agent activated. Analyzing code quality...',
        action: 'start_review',
      };
    },
  },
  {
    name: 'refactor',
    description: 'Switch to Refactor Agent for improvements',
    category: 'agent',
    handler: (_args, context) => {
      if (!['REVIEW', 'REFACTOR'].includes(context.workflowState)) {
        return {
          success: false,
          error: `Cannot start Refactor Agent from state: ${context.workflowState}`,
        };
      }
      context.setCurrentAgent('refactor_agent');
      context.setWorkflowState('REFACTOR');
      return {
        success: true,
        message: 'Refactor Agent activated. Analyzing technical debt...',
        action: 'start_refactor',
      };
    },
  },
  {
    name: 'stop',
    description: 'Stop current agent operation',
    category: 'agent',
    handler: (_args, context) => {
      const currentAgent = context.currentAgent;
      context.setCurrentAgent(null);
      return {
        success: true,
        message: currentAgent ? `Stopped ${currentAgent}` : 'No agent running',
        action: 'stop_agent',
      };
    },
  },

  // Model / Auth Commands
  {
    name: 'model',
    description: 'View or change current model',
    usage: '/model [model-name]',
    category: 'model',
    handler: (args, context) => {
      if (args.length === 0) {
        return {
          success: true,
          message: `Current model: ${context.currentModel}

Available models:
  - gpt-5.3-codex (OpenAI)
  - glm-5 (GLM)
  - minimax-2.5 (MiniMax)
  - kimi-k2.5 (Kimi)

Usage: /model <model-name>`,
        };
      }

      const newModel = args[0];
      const validModels = ['gpt-5.3-codex', 'glm-5', 'minimax-2.5', 'kimi-k2.5'];

      if (!validModels.includes(newModel || '')) {
        return {
          success: false,
          error: `Invalid model: ${newModel}. Valid models: ${validModels.join(', ')}`,
        };
      }

      context.setCurrentModel(newModel!);
      return {
        success: true,
        message: `Model changed to: ${newModel}`,
        action: 'change_model',
        data: { model: newModel },
      };
    },
  },
  {
    name: 'auth',
    description: 'Show authentication status',
    category: 'model',
    handler: (_args, _context) => {
      return {
        success: true,
        message: `Authentication Status:

Provider API Keys:
  - OPENAI_API_KEY: Check with 'matrix auth status'
  - GLM_API_KEY: Check with 'matrix auth status'
  - MINIMAX_API_KEY: Check with 'matrix auth status'
  - KIMI_API_KEY: Check with 'matrix auth status'

Use 'matrix auth add <provider>' to add keys.`,
        action: 'show_auth',
      };
    },
  },
  {
    name: 'quota',
    description: 'Show quota and usage information',
    category: 'model',
    handler: (_args, _context) => {
      return {
        success: true,
        message: 'Fetching quota information...',
        action: 'show_quota',
      };
    },
  },
  {
    name: 'telemetry',
    description: 'View or set telemetry mode',
    usage: '/telemetry [off|minimal|diagnostic|enable|disable]',
    category: 'model',
    handler: (args, _context) => {
      const modeInput = args[0]?.toLowerCase();

      if (!modeInput) {
        return {
          success: true,
          message: `Telemetry modes:
  - off: No telemetry
  - minimal: Essential only
  - diagnostic: Full telemetry

Usage: /telemetry <mode>`,
        };
      }

      const normalizedMode = modeInput === 'enable'
        ? 'diagnostic'
        : modeInput === 'disable'
          ? 'off'
          : modeInput;
      const validModes = ['off', 'minimal', 'diagnostic'];
      if (!validModes.includes(normalizedMode)) {
        return {
          success: false,
          error: `Invalid mode: ${modeInput}. Valid modes: off, minimal, diagnostic`,
        };
      }

      return {
        success: true,
        message: `Telemetry set to: ${normalizedMode}`,
        action: 'set_telemetry',
        data: { mode: normalizedMode },
      };
    },
  },

  // Tool / MCP Commands
  {
    name: 'tools',
    description: 'List available tools',
    category: 'tool',
    handler: (_args, _context) => {
      return {
        success: true,
        message: `Available Tools:

File System:
  - fs_read, fs_write, fs_list, fs_delete
  - fs_mkdir, fs_move, fs_copy

Git:
  - git_status, git_diff, git_add, git_commit
  - git_log, git_branch

Execution:
  - exec, exec_shell, exec_stream

Patch:
  - create_diff, apply_patch, apply_hunk

Search:
  - search, find_files

Testing:
  - run_tests, detect_framework

Formatting:
  - format_file, format_files

Linting:
  - lint_file, lint_files

HTTP:
  - http_fetch (requires approval)`,
        action: 'show_tools',
      };
    },
  },
  {
    name: 'mcp',
    description: 'MCP server management',
    usage: '/mcp [list|enable|disable] [server]',
    category: 'tool',
    handler: (args, _context) => {
      const subCommand = args[0];

      if (subCommand === 'list') {
        return {
          success: true,
          message: 'MCP Servers: (none configured)',
          action: 'show_mcp',
        };
      }

      return {
        success: true,
        message: `MCP Commands:
  - /mcp list - List configured MCP servers
  - /mcp enable <server> - Enable a server
  - /mcp disable <server> - Disable a server`,
      };
    },
  },
  {
    name: 'approval',
    description: 'View or set approval mode',
    usage: '/approval [strict|balanced|fast]',
    category: 'tool',
    handler: (args, _context) => {
      const mode = args[0];

      if (!mode) {
        return {
          success: true,
          message: `Approval Modes:
  - strict: Ask for every write/exec
  - balanced: Ask for write/exec, read is free (default)
  - fast: Auto-approve allowlist, ask for risky

Usage: /approval <mode>`,
        };
      }

      const validModes = ['strict', 'balanced', 'fast'];
      if (!validModes.includes(mode)) {
        return {
          success: false,
          error: `Invalid mode: ${mode}. Valid modes: ${validModes.join(', ')}`,
        };
      }

      return {
        success: true,
        message: `Approval mode set to: ${mode}`,
        action: 'set_approval',
        data: { mode },
      };
    },
  },
  {
    name: 'sandbox',
    description: 'View or configure sandbox settings',
    usage: '/sandbox [enable|disable|status]',
    category: 'tool',
    handler: (args, _context) => {
      const subCommand = args[0];

      if (!subCommand) {
        return {
          success: true,
          message: `Sandbox Commands:
  - /sandbox status - Show sandbox status
  - /sandbox enable - Enable sandbox mode
  - /sandbox disable - Disable sandbox mode`,
        };
      }

      if (subCommand === 'status') {
        return {
          success: true,
          message: 'Sandbox: disabled',
          action: 'set_sandbox',
          data: { status: 'disabled' },
        };
      }

      if (subCommand === 'enable' || subCommand === 'disable') {
        return {
          success: true,
          message: `Sandbox ${subCommand}d`,
          action: 'set_sandbox',
          data: { enabled: subCommand === 'enable' },
        };
      }

      return {
        success: false,
        error: `Unknown subcommand: ${subCommand}`,
      };
    },
  },

  // Help command
  {
    name: 'help',
    aliases: ['?'],
    description: 'Show help for commands',
    usage: '/help [command]',
    category: 'session',
    handler: (args, _context) => {
      const commandName = args[0];

      if (commandName) {
        const cmd = COMMANDS.find(c => c.name === commandName || c.aliases?.includes(commandName));
        if (cmd) {
          return {
            success: true,
            message: `/${cmd.name}${cmd.usage ? ' ' + cmd.usage : ''}

${cmd.description}`,
          };
        }
        return {
          success: false,
          error: `Unknown command: ${commandName}`,
        };
      }

      const categories = {
        session: COMMANDS.filter(c => c.category === 'session'),
        project: COMMANDS.filter(c => c.category === 'project'),
        agent: COMMANDS.filter(c => c.category === 'agent'),
        model: COMMANDS.filter(c => c.category === 'model'),
        tool: COMMANDS.filter(c => c.category === 'tool'),
      };

      let help = 'Matrix CLI Commands\n\n';

      for (const [cat, cmds] of Object.entries(categories)) {
        help += `${cat.toUpperCase()}\n`;
        for (const cmd of cmds) {
          help += `  /${cmd.name.padEnd(12)} - ${cmd.description}\n`;
        }
        help += '\n';
      }

      help += 'Type /help <command> for detailed help.';

      return { success: true, message: help };
    },
  },
];

/**
 * Parse a command string
 */
export function parseCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1);

  return { command, args };
}

/**
 * Execute a command
 */
export async function executeCommand(
  input: string,
  context: CommandContext
): Promise<CommandResult> {
  const parsed = parseCommand(input);

  if (!parsed) {
    return normalizeCommandResult({
      success: false,
      error: 'Invalid command format. Commands start with /',
    });
  }

  const { command, args } = parsed;

  // Find command by name or alias
  const cmd = COMMANDS.find(
    c => c.name === command || c.aliases?.includes(command)
  );

  if (!cmd) {
    return normalizeCommandResult({
      success: false,
      error: `Unknown command: /${command}. Type /help for available commands.`,
    });
  }

  // Check if argument is required
  if (cmd.requiresArg && args.length === 0) {
    return normalizeCommandResult({
      success: false,
      error: `Command /${command} requires an argument. Usage: ${cmd.usage || cmd.name}`,
    });
  }

  // Execute handler
  try {
    const result = cmd.handler(args, context);

    // Handle async handlers
    if (result instanceof Promise) {
      return normalizeCommandResult(await result);
    }

    return normalizeCommandResult(result);
  } catch (error) {
    return normalizeCommandResult({
      success: false,
      error: error instanceof Error ? error.message : 'Command execution failed',
    });
  }
}

function normalizeCommandResult(result: CommandResult): CommandResult {
  if (result.status) {
    return result;
  }

  if (result.success) {
    return { ...result, status: 'success' };
  }

  return { ...result, status: 'error' };
}

/**
 * Get command suggestions for autocomplete
 */
export function getCommandSuggestions(input: string): string[] {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return [];
  }

  const query = trimmed.slice(1).toLowerCase();
  const parts = query.split(/\s+/);

  // If only command name (no spaces)
  if (parts.length === 1) {
    return COMMANDS
      .filter(c => c.name.startsWith(query) || c.aliases?.some(a => a.startsWith(query)))
      .map(c => c.name);
  }

  // Subcommand suggestions could be added here
  return [];
}

/**
 * Get all command names for help
 */
export function getCommandNames(): string[] {
  return COMMANDS.map(c => c.name);
}
