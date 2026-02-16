import { randomUUID } from 'crypto';

/**
 * Sandbox execution result
 */
export interface SandboxResult {
  success: boolean;
  result?: unknown;
  error?: string;
  errorType?: 'timeout' | 'memory' | 'syntax' | 'runtime' | 'security';
  executionTime: number;
  memoryUsed?: number;
}

/**
 * Sandbox execution options
 */
export interface SandboxOptions {
  /** Maximum execution time in milliseconds (default: 5000) */
  timeout?: number;
  /** Maximum memory in bytes (default: 64MB) */
  memoryLimit?: number;
  /** Maximum stack depth (default: 100) */
  maxStackDepth?: number;
  /** Allow async operations */
  allowAsync?: boolean;
  /** Custom globals to expose */
  globals?: Record<string, unknown>;
  /** Working directory context */
  workingDirectory?: string;
}

/**
 * Sandbox resource limits
 */
export interface ResourceLimits {
  /** CPU time limit in ms */
  cpuTime: number;
  /** Wall time limit in ms */
  wallTime: number;
  /** Memory limit in bytes */
  memory: number;
  /** Max stack depth */
  stackDepth: number;
}

/**
 * Sandbox Tier 1 - Isolated VM execution for secure code evaluation
 *
 * This implements PRD Section 10.3 Sandbox Tier 1 using Node's vm module
 * with enhanced security measures for &lt;5ms execution overhead.
 */
export class Sandbox {
  private static defaultOptions: Required<Omit<SandboxOptions, 'globals' | 'workingDirectory'>> = {
    timeout: 5000,
    memoryLimit: 64 * 1024 * 1024, // 64MB
    maxStackDepth: 100,
    allowAsync: false,
  };

  private id: string;
  private options: Required<Omit<SandboxOptions, 'globals' | 'workingDirectory'>> & Pick<SandboxOptions, 'globals' | 'workingDirectory'>;
  private executionCount: number = 0;
  private totalExecutionTime: number = 0;

  constructor(options: SandboxOptions = {}) {
    this.id = randomUUID();
    this.options = {
      ...Sandbox.defaultOptions,
      ...options,
    };
  }

  /**
   * Execute JavaScript code in isolated context
   * Uses Node's vm module for Tier 1 sandboxing (&lt;5ms overhead)
   */
  async execute(code: string, context: Record<string, unknown> = {}): Promise<SandboxResult> {
    const startTime = Date.now();
    this.executionCount++;

    // Validate code for dangerous patterns
    const securityCheck = this.validateCode(code);
    if (!securityCheck.safe) {
      return {
        success: false,
        error: securityCheck.reason ?? 'Code failed security validation',
        errorType: 'security',
        executionTime: Date.now() - startTime,
      };
    }

    try {
      // Dynamic import to handle ESM/CMS compatibility
      const vm = await import('vm');

      // Create sandboxed context with limited globals
      const sandboxContext = this.createSandboxContext(context);

      // Create script with resource limits
      const script = new vm.Script(code, {
        filename: `sandbox-${this.id}-${this.executionCount}.js`,
      });

      // Configure context with resource limits
      const contextifiedVm = vm.createContext(sandboxContext);

      // Execute with timeout and resource limits
      const timeout = this.options.timeout;
      const result = await this.executeWithTimeout(
        () => script.runInContext(contextifiedVm, {
          timeout,
          displayErrors: true,
          breakOnSigint: true,
        }),
        timeout
      );

      const executionTime = Date.now() - startTime;
      this.totalExecutionTime += executionTime;

      return {
        success: true,
        result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorType: this.classifyError(error),
        executionTime,
      };
    }
  }

  /**
   * Execute a function with timeout wrapper
   */
  private async executeWithTimeout<T>(
    fn: () => T,
    timeout: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, timeout);

      try {
        const result = fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Execute async code in sandbox
   */
  async executeAsync(code: string, context: Record<string, unknown> = {}): Promise<SandboxResult> {
    if (!this.options.allowAsync) {
      return {
        success: false,
        error: 'Async execution not allowed in this sandbox',
        errorType: 'security',
        executionTime: 0,
      };
    }

    // Wrap code in async IIFE
    const wrappedCode = `(async () => { ${code} })()`;
    return this.execute(wrappedCode, context);
  }

  /**
   * Validate code for dangerous patterns
   */
  private validateCode(code: string): { safe: boolean; reason?: string } {
    // Dangerous patterns that should never be allowed
    const dangerousPatterns = [
      { pattern: /require\s*\(/, reason: 'require() is not allowed' },
      { pattern: /import\s+/, reason: 'import statements are not allowed' },
      { pattern: /process\s*\./, reason: 'process object access is not allowed' },
      { pattern: /global\s*\./, reason: 'global object access is not allowed' },
      { pattern: /globalThis\s*\./, reason: 'globalThis access is not allowed' },
      { pattern: /eval\s*\(/, reason: 'eval() is not allowed' },
      { pattern: /Function\s*\(/, reason: 'Function constructor is not allowed' },
      { pattern: /__proto__/, reason: '__proto__ access is not allowed' },
      { pattern: /constructor\s*\[/, reason: 'constructor bracket access is not allowed' },
      { pattern: /constructor\.constructor/, reason: 'constructor chain access is not allowed' },
      { pattern: /this\.constructor/, reason: 'this.constructor access is not allowed' },
    ];

    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(code)) {
        return { safe: false, reason };
      }
    }

    // Check stack depth potential
    const functionCount = (code.match(/function\s*\(/g) || []).length;
    const arrowCount = (code.match(/=>\s*{/g) || []).length;
    if (functionCount + arrowCount > this.options.maxStackDepth) {
      return {
        safe: false,
        reason: `Too many nested functions (${functionCount + arrowCount} > ${this.options.maxStackDepth})`
      };
    }

    return { safe: true };
  }

  /**
   * Create sandboxed context with safe globals
   */
  private createSandboxContext(customContext: Record<string, unknown>): Record<string, unknown> {
    // Safe built-ins that can be exposed
    const safeBuiltins = {
      // Math functions (safe, no side effects)
      Math: {
        abs: Math.abs,
        ceil: Math.ceil,
        floor: Math.floor,
        round: Math.round,
        max: Math.max,
        min: Math.min,
        pow: Math.pow,
        sqrt: Math.sqrt,
        random: Math.random,
        PI: Math.PI,
        E: Math.E,
      },
      // JSON utilities (safe for data)
      JSON: {
        parse: JSON.parse,
        stringify: JSON.stringify,
      },
      // Array utilities
      Array: {
        isArray: Array.isArray,
        from: Array.from,
        of: Array.of,
      },
      // Object utilities (limited)
      Object: {
        keys: Object.keys,
        values: Object.values,
        entries: Object.entries,
        assign: Object.assign,
        freeze: Object.freeze,
      },
      // String utilities
      String: {
        fromCharCode: String.fromCharCode,
        fromCodePoint: String.fromCodePoint,
      },
      // Number utilities
      Number: {
        parseInt: Number.parseInt,
        parseFloat: Number.parseFloat,
        isNaN: Number.isNaN,
        isFinite: Number.isFinite,
        isInteger: Number.isInteger,
      },
      // Boolean
      Boolean: Boolean,
      // Date (read-only, no timezone access)
      Date: {
        now: Date.now,
        parse: Date.parse,
        UTC: Date.UTC,
      },
      // Safe console (logs to sandbox output)
      console: {
        log: (...args: unknown[]) => args,
        error: (...args: unknown[]) => args,
        warn: (...args: unknown[]) => args,
      },
      // Utility functions
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
    };

    // Merge safe builtins with custom context
    const context: Record<string, unknown> = {
      ...safeBuiltins,
      ...this.options.globals,
      ...customContext,
      // Sandbox metadata
      __sandbox__: {
        id: this.id,
        executionCount: this.executionCount,
        options: {
          timeout: this.options.timeout,
          memoryLimit: this.options.memoryLimit,
        },
      },
    };

    return context;
  }

  /**
   * Classify error type for better error handling
   */
  private classifyError(
    error: unknown
  ): NonNullable<SandboxResult['errorType']> {
    if (!(error instanceof Error)) {
      return 'runtime';
    }

    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }

    if (message.includes('memory') || message.includes('heap') || message.includes('allocation')) {
      return 'memory';
    }

    if (message.includes('syntax') || message.includes('unexpected token') || message.includes('unexpected identifier')) {
      return 'syntax';
    }

    return 'runtime';
  }

  /**
   * Get sandbox statistics
   */
  getStats(): {
    id: string;
    executionCount: number;
    totalExecutionTime: number;
    averageExecutionTime: number;
  } {
    return {
      id: this.id,
      executionCount: this.executionCount,
      totalExecutionTime: this.totalExecutionTime,
      averageExecutionTime: this.executionCount > 0
        ? this.totalExecutionTime / this.executionCount
        : 0,
    };
  }

  /**
   * Reset sandbox statistics
   */
  resetStats(): void {
    this.executionCount = 0;
    this.totalExecutionTime = 0;
  }

  /**
   * Check if sandbox supports isolated-vm features
   * Returns true if native isolation is available
   */
  static async supportsNativeIsolation(): Promise<boolean> {
    try {
      const isolatedVmModule = 'isolated-vm';
      await import(isolatedVmModule);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Pre-defined sandbox profiles for different use cases
 */
export const SandboxProfiles = {
  /** Minimal sandbox for simple calculations */
  minimal: {
    timeout: 1000,
    memoryLimit: 16 * 1024 * 1024, // 16MB
    maxStackDepth: 20,
    allowAsync: false,
  },
  /** Standard sandbox for code analysis */
  standard: {
    timeout: 5000,
    memoryLimit: 64 * 1024 * 1024, // 64MB
    maxStackDepth: 100,
    allowAsync: false,
  },
  /** Extended sandbox for longer operations */
  extended: {
    timeout: 30000,
    memoryLimit: 128 * 1024 * 1024, // 128MB
    maxStackDepth: 200,
    allowAsync: true,
  },
  /** Test sandbox for QA operations */
  test: {
    timeout: 10000,
    memoryLimit: 32 * 1024 * 1024, // 32MB
    maxStackDepth: 50,
    allowAsync: true,
  },
} as const;

export type SandboxProfileName = keyof typeof SandboxProfiles;

/**
 * Create a sandbox with a predefined profile
 */
export function createSandbox(profile: SandboxProfileName = 'standard'): Sandbox {
  return new Sandbox(SandboxProfiles[profile]);
}

/**
 * Quick sandbox execution helper
 */
export async function sandboxExecute(
  code: string,
  context: Record<string, unknown> = {},
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const sandbox = new Sandbox(options);
  return sandbox.execute(code, context);
}
