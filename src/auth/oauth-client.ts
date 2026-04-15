/**
 * OAuth 2.0 + PKCE implementation for TikTok
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { OAuthTokens, OAuthResponse, Scope } from '../core/types.js';
import {
  OAuthError,
  InvalidGrantError,
  ConfigurationError,
} from '../core/errors.js';

const logger = createLogger('OAuthClient');

// Default scopes for OAuth
export const DEFAULT_SCOPES: Scope[] = ['user.info.basic'];

/**
 * Generate PKCE code verifier and challenge
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export class TikTokOAuthClient {
  // TikTok OAuth Endpoints
  private readonly AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize';
  private readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  private readonly REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';

  // PKCE code verifier storage (in-memory, could be persisted)
  private codeVerifiers: Map<string, string> = new Map();

  /**
   * Generate authorization URL with PKCE
   */
  public async generateAuthUrl(
    clientId: string,
    redirectUri: string,
    scopes: Scope[] = ['user.info.basic'],
    state: string
  ): Promise<string> {
    // Validate required parameters
    if (!clientId) {
      throw new ConfigurationError('TIKTOK_CLIENT_KEY is not set');
    }
    if (!redirectUri) {
      throw new ConfigurationError('TIKTOK_REDIRECT_URI is not set');
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    // Store code verifier for later use in token exchange
    this.codeVerifiers.set(state, codeVerifier);
    logger.debug('Generated PKCE parameters', { state: state.substring(0, 8) + '...' });

    // Build authorization URL
    const params = new URLSearchParams({
      client_key: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(','),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      response_type: 'code',
    });

    return `${this.AUTH_BASE}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  public async exchangeCode(
    code: string,
    redirectUri: string,
    state: string
  ): Promise<OAuthResponse> {
    const codeVerifier = this.codeVerifiers.get(state);
    
    if (!codeVerifier) {
      throw new OAuthError('Code verifier not found. Please restart the OAuth flow.', 'CODE_VERIFIER_NOT_FOUND');
    }

    // Clean up code verifier after use
    this.codeVerifiers.delete(state);

    const requestBody = {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    };

    logger.info('Exchanging authorization code for tokens');

    try {
      const response = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json() as OAuthResponse;

      if (!response.ok) {
        const errorData = data as { error?: string; error_description?: string };
        throw new InvalidGrantError(
          errorData.error_description || 'Failed to exchange authorization code',
          { error: errorData.error, code }
        );
      }

      logger.info('Tokens received successfully');
      return data;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(`Failed to exchange code: ${error}`, 'TOKEN_EXCHANGE_FAILED');
    }
  }

  /**
   * Refresh expired access token
   */
  public async refreshToken(
    refresh_token: string,
    clientId: string
  ): Promise<OAuthTokens> {
    logger.info('Refreshing access token');

    const requestBody = {
      client_key: clientId,
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
    };

    try {
      const response = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json() as OAuthTokens;

      if (!response.ok) {
        const errorData = data as { error?: string; error_description?: string };
        throw new InvalidGrantError(
          errorData.error_description || 'Failed to refresh token',
          { error: errorData.error }
        );
      }

      logger.info('Token refreshed successfully');
      return data;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(`Failed to refresh token: ${error}`, 'REFRESH_FAILED');
    }
  }

  /**
   * Revoke access token (logout)
   */
  public async revokeToken(token: string): Promise<void> {
    logger.info('Revoking access token');

    try {
      const response = await fetch(this.REVOKE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: token,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn('Token revocation failed', { error });
        // Don't throw - token might already be expired/invalid
      }

      logger.info('Token revoked successfully');
    } catch (error) {
      logger.error('Failed to revoke token', { error });
      // Silently fail - token might already be invalid
    }
  }

  /**
   * Generate PKCE code verifier (32-128 characters)
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge (SHA256 of code verifier)
   */
  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const buffer = Buffer.from(codeVerifier, 'utf-8');
    const hash = crypto.createHash('sha256').update(buffer).digest();
    return hash.toString('base64url');
  }

  /**
   * Get authorization URL for user to open in browser
   */
  public getBrowserAuthUrl(authUrl: string): string {
    return authUrl;
  }
}

// Export singleton instance
export const oauthClient = new TikTokOAuthClient();
