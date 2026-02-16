import { SECRET_PATTERNS, RISKY_PATTERNS, FILE_DENYLIST } from './patterns.js';
import type { PolicyDecision } from '@matrix/core';

/**
 * Scan result for secrets
 */
export interface SecretScanResult {
  found: boolean;
  secrets: Array<{
    type: string;
    pattern: string;
    match: string;
    line?: number;
    redacted: string;
  }>;
}

/**
 * Scan result for risks
 */
export interface RiskScanResult {
  found: boolean;
  risks: Array<{
    type: string;
    risk: 'low' | 'medium' | 'high';
    description: string;
    line?: number;
  }>;
}

/**
 * Path scan result
 */
export interface PathScanResult {
  safe: boolean;
  issues: Array<{
    type: 'traversal' | 'denylist' | 'absolute';
    message: string;
    path: string;
  }>;
}

/**
 * Guardian Gate - Security scanner for content, paths, and commands
 */
export class GuardianGate {
  private additionalSecretPatterns: Array<{ name: string; pattern: RegExp }>;
  private additionalDenylist: string[];

  constructor() {
    this.additionalSecretPatterns = [];
    this.additionalDenylist = [];
  }

  /**
   * Add a custom secret pattern
   */
  addSecretPattern(name: string, pattern: RegExp): void {
    this.additionalSecretPatterns.push({ name, pattern });
  }

  /**
   * Add file to denylist
   */
  addToDenylist(pattern: string): void {
    this.additionalDenylist.push(pattern);
  }

  /**
   * Scan content for secrets
   */
  scanSecrets(content: string): SecretScanResult {
    const secrets: SecretScanResult['secrets'] = [];

    // Check standard patterns
    for (const { name, pattern, description } of SECRET_PATTERNS) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const redacted = this.redactSecret(match[0]);
        secrets.push({
          type: name,
          pattern: description,
          match: match[0].slice(0, 20) + '...',
          redacted,
          line: this.getLineNumber(content, match.index ?? 0),
        });
      }
    }

    // Check custom patterns
    for (const { name, pattern } of this.additionalSecretPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const redacted = this.redactSecret(match[0]);
        secrets.push({
          type: name,
          pattern: 'Custom pattern',
          match: match[0].slice(0, 20) + '...',
          redacted,
          line: this.getLineNumber(content, match.index ?? 0),
        });
      }
    }

    return {
      found: secrets.length > 0,
      secrets,
    };
  }

  /**
   * Scan content for risky patterns
   */
  scanRisks(content: string): RiskScanResult {
    const risks: RiskScanResult['risks'] = [];

    for (const { name, pattern, risk, description } of RISKY_PATTERNS) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        risks.push({
          type: name,
          risk,
          description,
          line: this.getLineNumber(content, match.index ?? 0),
        });
      }
    }

    return {
      found: risks.length > 0,
      risks,
    };
  }

  /**
   * Scan file path for safety
   */
  scanPath(filePath: string, workingDirectory: string): PathScanResult {
    const issues: PathScanResult['issues'] = [];
    const normalizedPath = this.normalizePath(filePath);
    const normalizedWorkingDir = this.normalizePath(workingDirectory);

    // Check for path traversal
    if (normalizedPath.includes('..')) {
      issues.push({
        type: 'traversal',
        message: 'Path contains directory traversal sequence',
        path: filePath,
      });
    }

    // Check if path is absolute and outside working directory
    if (this.isAbsolutePath(normalizedPath)) {
      if (!normalizedPath.startsWith(normalizedWorkingDir)) {
        issues.push({
          type: 'absolute',
          message: 'Absolute path is outside working directory',
          path: filePath,
        });
      }
    }

    // Check denylist
    const fileName = this.getFileName(normalizedPath);
    const allDenylist = [...FILE_DENYLIST, ...this.additionalDenylist];

    for (const pattern of allDenylist) {
      if (this.matchesPattern(fileName, pattern)) {
        issues.push({
          type: 'denylist',
          message: `File matches denylist pattern: ${pattern}`,
          path: filePath,
        });
        break;
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  /**
   * Redact secrets from content
   */
  redactContent(content: string): string {
    let redacted = content;

    for (const { pattern } of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => this.redactSecret(match));
    }

    for (const { pattern } of this.additionalSecretPatterns) {
      redacted = redacted.replace(pattern, (match) => this.redactSecret(match));
    }

    return redacted;
  }

  /**
   * Check if content contains secrets
   */
  hasSecrets(content: string): boolean {
    for (const { pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get overall risk level for content
   */
  getRiskLevel(content: string): 'none' | 'low' | 'medium' | 'high' {
    const riskResult = this.scanRisks(content);
    const secretResult = this.scanSecrets(content);

    if (secretResult.found) {
      return 'high';
    }

    if (riskResult.found) {
      const hasHigh = riskResult.risks.some((r) => r.risk === 'high');
      const hasMedium = riskResult.risks.some((r) => r.risk === 'medium');

      if (hasHigh) return 'high';
      if (hasMedium) return 'medium';
      return 'low';
    }

    return 'none';
  }

  /**
   * Determine policy decision based on scans
   */
  determineDecision(
    content: string,
    operation: 'read' | 'write' | 'exec'
  ): PolicyDecision {
    const secretResult = this.scanSecrets(content);
    const riskResult = this.scanRisks(content);

    // Always block if secrets found in write/exec
    if (secretResult.found && operation !== 'read') {
      return 'block';
    }

    // Warn for high risks
    if (riskResult.risks.some((r) => r.risk === 'high')) {
      return operation === 'read' ? 'warn' : 'needs_approval';
    }

    // Needs approval for medium risks in write/exec
    if (riskResult.risks.some((r) => r.risk === 'medium') && operation !== 'read') {
      return 'needs_approval';
    }

    return 'allow';
  }

  /**
   * Redact a secret value
   */
  private redactSecret(value: string): string {
    if (value.length <= 8) {
      return '***';
    }
    return value.slice(0, 4) + '***' + value.slice(-4);
  }

  /**
   * Get line number from index
   */
  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
  }

  /**
   * Normalize path separators
   */
  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  /**
   * Check if path is absolute
   */
  private isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:/.test(path);
  }

  /**
   * Get file name from path
   */
  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  }

  /**
   * Match file name against pattern
   */
  private matchesPattern(fileName: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
      );
      return regex.test(fileName);
    }
    return fileName === pattern;
  }
}

/**
 * Create a GuardianGate instance
 */
export function createGuardianGate(): GuardianGate {
  return new GuardianGate();
}
