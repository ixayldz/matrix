/**
 * Secret detection patterns
 */
export const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; description: string }> = [
  // API Keys
  {
    name: 'openai_api_key',
    pattern: /sk-[a-zA-Z0-9]{20,}T3BlbkFJ[a-zA-Z0-9]{20,}/g,
    description: 'OpenAI API Key',
  },
  {
    name: 'anthropic_api_key',
    pattern: /sk-ant-api[a-zA-Z0-9-]{20,}/g,
    description: 'Anthropic API Key',
  },
  {
    name: 'generic_api_key',
    pattern: /(?:api[_-]?key|apikey|access[_-]?key)\s*[=:]\s*['"]?[a-zA-Z0-9_\-]{20,}['"]?/gi,
    description: 'Generic API Key',
  },
  {
    name: 'aws_access_key',
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    description: 'AWS Access Key ID',
  },
  {
    name: 'aws_secret_key',
    pattern: /(?:aws[_-]?secret[_-]?key|aws[_-]?secret[_-]?access[_-]?key)\s*[=:]\s*['"]?[a-zA-Z0-9/+=]{40}['"]?/gi,
    description: 'AWS Secret Access Key',
  },
  {
    name: 'google_api_key',
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    description: 'Google API Key',
  },
  {
    name: 'github_token',
    pattern: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/g,
    description: 'GitHub Personal Access Token',
  },
  {
    name: 'stripe_key',
    pattern: /(?:sk_live|sk_test)_[a-zA-Z0-9]{24,}/g,
    description: 'Stripe API Key',
  },
  {
    name: 'jwt_token',
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    description: 'JWT Token',
  },

  // Private Keys
  {
    name: 'rsa_private_key',
    pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
    description: 'RSA Private Key',
  },
  {
    name: 'ec_private_key',
    pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
    description: 'EC Private Key',
  },
  {
    name: 'openssh_private_key',
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
    description: 'OpenSSH Private Key',
  },
  {
    name: 'pgp_private_key',
    pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
    description: 'PGP Private Key Block',
  },

  // Database URLs
  {
    name: 'database_url',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]+/gi,
    description: 'Database Connection URL',
  },

  // Generic secrets
  {
    name: 'secret',
    pattern: /(?:secret|password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi,
    description: 'Generic Secret/Password',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
    description: 'Bearer Token',
  },
  {
    name: 'basic_auth',
    pattern: /Basic\s+[a-zA-Z0-9+/=]+/gi,
    description: 'Basic Authentication Header',
  },
];

/**
 * Risky patterns that should be flagged
 */
export const RISKY_PATTERNS: Array<{ name: string; pattern: RegExp; risk: 'low' | 'medium' | 'high'; description: string }> = [
  // Command injection risks
  {
    name: 'eval_usage',
    pattern: /\beval\s*\(/g,
    risk: 'high',
    description: 'Use of eval() function',
  },
  {
    name: 'exec_usage',
    pattern: /\bexec\s*\(/g,
    risk: 'medium',
    description: 'Use of exec() function',
  },
  {
    name: 'child_process',
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)/g,
    risk: 'medium',
    description: 'Import of child_process module',
  },

  // SQL injection risks
  {
    name: 'sql_concat',
    pattern: /['"]\s*\+\s*\w+\s*\+\s*['"]/g,
    risk: 'medium',
    description: 'SQL string concatenation',
  },
  {
    name: 'sql_template_literal',
    pattern: /`[^`]*\$\{[^}]+\}[^`]*`/g,
    risk: 'low',
    description: 'Template literal in SQL context',
  },

  // XSS risks
  {
    name: 'innerHTML',
    pattern: /\.innerHTML\s*=/g,
    risk: 'medium',
    description: 'Direct innerHTML assignment',
  },
  {
    name: 'dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML/g,
    risk: 'medium',
    description: 'React dangerouslySetInnerHTML',
  },

  // File system risks
  {
    name: 'fs_write',
    pattern: /(?:fs\.write|writeFile|writeFileSync)/g,
    risk: 'low',
    description: 'File write operation',
  },
  {
    name: 'fs_delete',
    pattern: /(?:fs\.unlink|unlinkSync|fs\.rm|rmSync|rmdir|rmdirSync)/g,
    risk: 'medium',
    description: 'File delete operation',
  },

  // Network risks
  {
    name: 'http_request',
    pattern: /(?:fetch|axios|http\.get|http\.post|request\()/g,
    risk: 'low',
    description: 'HTTP request',
  },
];

/**
 * File patterns that should be denied
 */
export const FILE_DENYLIST = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.*.local',
  '*.pem',
  '*.key',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  '*.ppk',
  '*.p12',
  '*.pfx',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  '.htpasswd',
  '.netrc',
  '_netrc',
  '.pgpass',
];

/**
 * Command patterns that should be denied
 */
export const COMMAND_DENYLIST = [
  /^rm\s+-rf\s+\//, // rm -rf /
  /^rm\s+-rf\s+~/, // rm -rf ~
  /^rm\s+-rf\s+\.\./, // rm -rf ..
  /^sudo\s/, // sudo
  /^su\s/, // su
  /^chmod\s+777/, // chmod 777
  /^chown\s+.*:.*\s+\//, // chown to root
  /^dd\s+if=/, // dd command
  /^mkfs/, // format filesystem
  /^fdisk/, // partition editor
  /^curl\s+.*\|\s*bash/, // curl | bash
  /^wget\s+.*\|\s*bash/, // wget | bash
  /^:()\s*{\s*:\s*:\s*};/, // fork bomb
  /^>\s*\/dev\/sda/, // overwrite disk
  /^mv\s+.*\s+\/dev\/null/, // move to null
];

/**
 * Commands that are allowed in fast mode
 */
export const COMMAND_ALLOWLIST = [
  /^git\s+/,
  /^npm\s+/,
  /^pnpm\s+/,
  /^yarn\s+/,
  /^node\s+/,
  /^npx\s+/,
  /^ls\s*/,
  /^cat\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^grep\s+/,
  /^find\s+/,
  /^mkdir\s+/,
  /^touch\s+/,
  /^echo\s+/,
  /^pwd\s*/,
  /^which\s+/,
  /^type\s+/,
  /^tsc\s+/,
  /^eslint\s+/,
  /^prettier\s+/,
  /^vitest\s+/,
  /^jest\s+/,
];

/**
 * Get compiled secret patterns
 */
export function getSecretPatterns(): RegExp[] {
  return SECRET_PATTERNS.map((p) => p.pattern);
}

/**
 * Get file denylist patterns
 */
export function getFileDenylistPatterns(): RegExp[] {
  return FILE_DENYLIST.map((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  });
}
