#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const rootDir = process.cwd();

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  'coverage',
  '.next',
  '.matrix',
]);

const ALLOWED_FILES = new Set([
  'prd.md',
  'AGENTS.md',
  'MATRIX.md',
  'pnpm-lock.yaml',
  'package-lock.json',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.ps1',
  '.env',
]);

const SECRET_PATTERNS = [
  { id: 'openai_key', regex: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { id: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'private_key', regex: /-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g },
  {
    id: 'assigned_secret_literal',
    regex: /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/gi,
  },
];

function isLikelyText(filePath) {
  for (const ext of TEXT_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function shouldSkipFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;

  if (ALLOWED_FILES.has(base)) {
    return true;
  }

  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) {
    return true;
  }

  if (normalized.includes('/packages/acceptance/')) {
    return true;
  }

  if (normalized === 'packages/security/src/patterns.ts') {
    return true;
  }

  if (normalized.includes('/dist/')) {
    return true;
  }

  return false;
}

function walk(directory, output = []) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, output);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    output.push(fullPath);
  }
  return output;
}

function scanFile(filePath) {
  const findings = [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const [lineIndex, line] of lines.entries()) {
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(line);
      if (!match) {
        continue;
      }

      findings.push({
        pattern: pattern.id,
        line: lineIndex + 1,
        snippet: line.trim().slice(0, 160),
      });
    }
  }

  return findings;
}

function main() {
  const files = walk(rootDir).filter((filePath) => {
    const rel = relative(rootDir, filePath);
    if (shouldSkipFile(rel)) {
      return false;
    }
    if (!isLikelyText(rel)) {
      return false;
    }
    try {
      return statSync(filePath).size < 2 * 1024 * 1024;
    } catch {
      return false;
    }
  });

  const issues = [];
  for (const filePath of files) {
    const rel = relative(rootDir, filePath);
    const findings = scanFile(filePath);
    for (const finding of findings) {
      issues.push({
        file: rel.replace(/\\/g, '/'),
        ...finding,
      });
    }
  }

  if (issues.length === 0) {
    console.log('security-scan: pass (no secret-like literals detected)');
    process.exit(0);
  }

  console.error(`security-scan: fail (${issues.length} potential secret findings)`);
  for (const issue of issues.slice(0, 20)) {
    console.error(`- ${issue.file}:${issue.line} [${issue.pattern}] ${issue.snippet}`);
  }
  if (issues.length > 20) {
    console.error(`... and ${issues.length - 20} more`);
  }
  process.exit(1);
}

main();
