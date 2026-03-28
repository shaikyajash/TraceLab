/**
 * Sanitize sensitive information from strings before sending to frontend.
 * Removes credentials, API keys, and other sensitive data.
 */

const SENSITIVE_PATTERNS = [
  // Git credentials in URLs
  /https?:\/\/[^:@\s]+:[^:@\s]+@/g,
  // API keys (common patterns)
  /api[_-]?key[=:]\s*[^\s&]+/gi,
  /bearer\s+[^\s]+/gi,
  /token[=:]\s*[^\s&]+/gi,
  // Anthropic API keys
  /sk-ant-[a-zA-Z0-9-_]+/g,
  // OpenAI API keys
  /sk-[a-zA-Z0-9]{48}/g,
  // Generic secrets
  /secret[=:]\s*[^\s&]+/gi,
  /password[=:]\s*[^\s&]+/gi,
];

/**
 * Remove sensitive data from a string
 */
export function sanitize(text: string): string {
  let sanitized = text;
  
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      // For URL credentials, replace with https://***:***@
      if (match.startsWith('http')) {
        return match.replace(/\/\/[^:@]+:[^:@]+@/, '//***:***@');
      }
      // For other patterns, replace with [REDACTED]
      return '[REDACTED]';
    });
  }
  
  return sanitized;
}

/**
 * Sanitize error messages
 */
export function sanitizeError(error: Error | unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitize(message);
}
