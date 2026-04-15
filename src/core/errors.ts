/**
 * Custom error classes for MCP-TikTok
 */

export class TikTokError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TikTokError';
  }
}

export class OAuthError extends TikTokError {
  constructor(
    message: string,
    code: string,
    statusCode?: number,
    details?: Record<string, unknown>
  ) {
    super(message, `OAUTH_${code}`, statusCode, details);
    this.name = 'OAuthError';
  }
}

export class TokenExpiredError extends OAuthError {
  constructor() {
    super('Access token has expired. Please refresh it.', 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

export class InvalidGrantError extends OAuthError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INVALID_GRANT', 400, details);
    this.name = 'InvalidGrantError';
  }
}

export class UnauthorizedError extends TikTokError {
  constructor() {
    super('Unauthorized. Please authenticate first.', 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends TikTokError {
  constructor(
    message = 'Rate limit exceeded. Please wait before making another request.',
    public readonly retryAfter?: number
  ) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends TikTokError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends TikTokError {
  constructor(resource: string) {
    super(`Resource not found: ${resource}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConfigurationError extends TikTokError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
    this.name = 'ConfigurationError';
  }
}
