import type { ToolResult } from '@matrix/core';

/**
 * HTTP fetch options
 */
export interface HttpFetchOptions {
  timeout?: number;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelay?: number;
  maxSize?: number;
  followRedirects?: boolean;
  userAgent?: string;
}

/**
 * HTTP fetch result
 */
export interface HttpFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  duration: number;
  contentType?: string;
}

/**
 * URL validation result
 */
export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  protocol?: string;
  host?: string;
}

// Blocked protocols and hosts for security
const BLOCKED_PROTOCOLS = ['file:', 'ftp:', 'data:', 'javascript:', 'vbscript:'];
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^localhost$/i,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/**
 * Validate URL for security
 */
export function validateUrl(url: string): UrlValidationResult {
  try {
    const parsed = new URL(url);

    // Check protocol
    if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
      return {
        valid: false,
        reason: `Blocked protocol: ${parsed.protocol}`,
      };
    }

    // Only allow http and https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`,
      };
    }

    // Check for private/internal IPs (SSRF protection)
    const hostname = parsed.hostname.toLowerCase();
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          valid: false,
          reason: 'Access to private/internal networks is not allowed',
        };
      }
    }

    return {
      valid: true,
      protocol: parsed.protocol,
      host: parsed.host,
    };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Invalid URL format',
    };
  }
}

/**
 * Default headers
 */
const DEFAULT_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Default user agent
 */
const DEFAULT_USER_AGENT = 'MatrixCLI/1.0 (Documentation Fetcher)';

/**
 * Fetch a URL
 *
 * NOTE: Per PRD Section 7.1, this tool requires user approval before execution.
 * The caller is responsible for obtaining approval before calling this function.
 */
export async function httpFetch(
  url: string,
  options: HttpFetchOptions = {}
): Promise<ToolResult<HttpFetchResult>> {
  const {
    timeout = 30000,
    headers = {},
    maxRetries = 0,
    retryDelay = 1000,
    maxSize = 10 * 1024 * 1024, // 10MB default
    followRedirects = true,
    userAgent = DEFAULT_USER_AGENT,
  } = options;

  const startTime = Date.now();

  // Validate URL first
  const validation = validateUrl(url);
  if (!validation.valid) {
    return {
      success: false,
      error: `URL validation failed: ${validation.reason}`,
    };
  }

  let lastError: string | undefined;
  let retries = 0;

  while (retries <= maxRetries) {
    try {
      // Build fetch options
      const fetchHeaders = new Headers({
        ...DEFAULT_HEADERS,
        'User-Agent': userAgent,
        ...headers,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: fetchHeaders,
          redirect: followRedirects ? 'follow' : 'manual',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // Check response size from header if available
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        return {
          success: false,
          error: `Response too large: ${contentLength} bytes (max: ${maxSize})`,
        };
      }

      // Read body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          success: false,
          error: 'No response body',
        };
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;
        if (totalSize > maxSize) {
          return {
            success: false,
            error: `Response exceeded maximum size of ${maxSize} bytes`,
          };
        }

        chunks.push(value);
      }

      // Combine chunks and decode
      const bodyBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        bodyBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const decoder = new TextDecoder('utf-8', { fatal: false });
      const body = decoder.decode(bodyBuffer);

      // Extract headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const result: HttpFetchResult = {
        url,
        finalUrl: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
        size: totalSize,
        duration: Date.now() - startTime,
        ...(response.headers.get('content-type')
          ? { contentType: response.headers.get('content-type') as string }
          : {}),
      };

      // Check for HTTP errors
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data: result,
        };
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      if (error instanceof Error) {
        lastError = error.message;

        // Don't retry on certain errors
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: `Request timed out after ${timeout}ms`,
          };
        }
      } else {
        lastError = 'Unknown error';
      }

      retries++;

      // Wait before retry
      if (retries <= maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * retries));
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries + 1} attempts: ${lastError}`,
  };
}

/**
 * Fetch with automatic retry
 */
export async function httpFetchWithRetry(
  url: string,
  options: HttpFetchOptions = {}
): Promise<ToolResult<HttpFetchResult>> {
  const { maxRetries = 3, retryDelay = 1000 } = options;
  return httpFetch(url, { ...options, maxRetries, retryDelay });
}

/**
 * Fetch documentation from a URL (convenience wrapper)
 */
export async function fetchDocumentation(
  url: string,
  options: Omit<HttpFetchOptions, 'headers'> = {}
): Promise<ToolResult<HttpFetchResult>> {
  return httpFetch(url, {
    ...options,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/markdown;q=0.8,text/plain;q=0.7,*/*;q=0.5',
    },
    userAgent: 'MatrixCLI/1.0 (Documentation Fetcher)',
  });
}
