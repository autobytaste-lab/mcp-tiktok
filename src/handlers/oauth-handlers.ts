/**
 * OAuth tool handlers (Phase 1).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Scope, AVAILABLE_SCOPES } from '../core/types.js';
import { oauthClient } from '../auth/oauth-client.js';
import { tokenManager } from '../auth/token-manager.js';
import { logger } from '../utils/logger.js';

export function registerOAuthHandlers(server: McpServer): void {
  // --- tiktok_oauth_init ---
  server.tool(
    'tiktok_oauth_init',
    'Initialize TikTok OAuth 2.0 + PKCE flow. Returns an authorization URL that the user must open in their browser.',
    {
      scopes: z
        .array(z.enum(['user.info.basic', 'user.info.email', 'user.info.phone_number', 'video.list', 'video.publish'] as const))
        .optional()
        .describe('OAuth scopes to request. Default: ["user.info.basic"]'),
      state: z.string().optional().describe('State parameter for CSRF protection (auto-generated if not provided)'),
    },
    async ({ scopes, state }) => {
      try {
        const requestedScopes: Scope[] = scopes?.length ? scopes : ['user.info.basic'];
        const finalState = state || `state_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        logger.info('Initializing OAuth flow', { scopes: requestedScopes });

        const clientId = process.env.TIKTOK_CLIENT_KEY;
        const redirectUri = process.env.TIKTOK_REDIRECT_URI;

        if (!clientId) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_CLIENT_KEY', message: 'TIKTOK_CLIENT_KEY environment variable is not set.' } }, null, 2) }] };
        }

        if (!redirectUri) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_REDIRECT_URI', message: 'TIKTOK_REDIRECT_URI environment variable is not set.' } }, null, 2) }] };
        }

        const authUrl = await oauthClient.generateAuthUrl(clientId, redirectUri, requestedScopes, finalState);

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { authorization_url: authUrl, state: finalState, instructions: ['1. Open the authorization_url in your browser', '2. Log in to TikTok and authorize your app', '3. You will be redirected to your redirect_uri with a code parameter', '4. Copy the code from the URL (e.g., ?code=ABC123...)', '5. Call tiktok_exchange_code with the code to complete authentication'] } }, null, 2) }],
        };
      } catch (error) {
        logger.error('OAuth init failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'OAUTH_INIT_FAILED', message: `Failed to initialize OAuth: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_exchange_code ---
  server.tool(
    'tiktok_exchange_code',
    'Exchange the authorization code (from OAuth callback) for access and refresh tokens. Tokens are stored securely.',
    {
      code: z.string().describe('Authorization code from TikTok redirect URL'),
      state: z.string().optional().describe('State parameter that was used in oauth_init call'),
    },
    async ({ code, state }) => {
      try {
        logger.info('Exchanging authorization code');

        const redirectUri = process.env.TIKTOK_REDIRECT_URI;
        if (!redirectUri) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_REDIRECT_URI', message: 'TIKTOK_REDIRECT_URI is not configured.' } }, null, 2) }] };
        }

        const oauthResponse = await oauthClient.exchangeCode(code, redirectUri, state || '');
        await tokenManager.storeTokens(oauthResponse, oauthResponse.open_id);

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, data: { message: 'Authentication successful! Tokens stored securely.', open_id: oauthResponse.open_id, scope: oauthResponse.scope, expires_in: oauthResponse.expires_in, token_file: tokenManager.getTokenFilePath(), next_steps: ['You can now use Display API tools (tiktok_display_*)', 'Check token status with tiktok_token_status', 'Token will auto-refresh when expired for supported operations'] } }, null, 2) }],
        };
      } catch (error) {
        logger.error('Code exchange failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'CODE_EXCHANGE_FAILED', message: `Failed to exchange code: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_refresh_token ---
  server.tool(
    'tiktok_refresh_token',
    'Refresh the expired access token using the stored refresh token.',
    {},
    async () => {
      try {
        const storedTokens = await tokenManager.getTokens();
        if (!storedTokens?.refresh_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token found. Please authenticate again using tiktok_oauth_init.' } }, null, 2) }] };
        }

        const clientId = process.env.TIKTOK_CLIENT_KEY;
        if (!clientId) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_CLIENT_KEY', message: 'TIKTOK_CLIENT_KEY is not configured.' } }, null, 2) }] };
        }

        const newTokens = await oauthClient.refreshToken(storedTokens.refresh_token, clientId);
        await tokenManager.storeTokens(newTokens, storedTokens.open_id);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { message: 'Access token refreshed successfully', expires_in: newTokens.expires_in, scope: newTokens.scope } }, null, 2) }] };
      } catch (error) {
        logger.error('Token refresh failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_REFRESH_FAILED', message: `Failed to refresh token: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_revoke_token ---
  server.tool(
    'tiktok_revoke_token',
    'Revoke the access token and delete stored tokens (logout).',
    {},
    async () => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { message: 'No tokens found to revoke. You are already logged out.' } }, null, 2) }] };
        }

        await oauthClient.revokeToken(storedTokens.access_token);
        await tokenManager.deleteTokens();

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { message: 'Successfully logged out. Tokens revoked and deleted.' } }, null, 2) }] };
      } catch (error) {
        logger.error('Token revocation failed', { error });
        try { await tokenManager.deleteTokens(); } catch {}
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { message: 'Local tokens deleted. (Remote revocation may have failed)' } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_token_status ---
  server.tool(
    'tiktok_token_status',
    'Check the current token status, expiry time, and scopes. Does not expose raw token values.',
    {},
    async () => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { authenticated: false, message: 'No tokens found. Please authenticate using tiktok_oauth_init.' } }, null, 2) }] };
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = storedTokens.expires_at || 0;
        const isExpired = now > expiresAt;
        const timeUntilExpiry = expiresAt - now;
        const hoursUntilExpiry = Math.max(0, Math.round(timeUntilExpiry / 3600));

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { authenticated: true, open_id: storedTokens.open_id, scope: storedTokens.scope, is_expired: isExpired, expires_at: new Date(expiresAt).toISOString(), hours_until_expiry: hoursUntilExpiry, has_refresh_token: !!storedTokens.refresh_token, token_file: tokenManager.getTokenFilePath() } }, null, 2) }] };
      } catch (error) {
        logger.error('Token status check failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_STATUS_FAILED', message: `Failed to check token status: ${error}` } }, null, 2) }] };
      }
    },
  );
}
