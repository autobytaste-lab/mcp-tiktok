/**
 * Login Kit tool handlers (Phase 2).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../core/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { LoginKitClient } from '../login-kit/client.js';
import type { UserInfoField } from '../login-kit/types.js';
import { logger } from '../utils/logger.js';

const loginKitClient = new LoginKitClient();

export function registerLoginKitHandlers(server: McpServer): void {
  server.tool(
    'tiktok_login_get_user_info',
    "Get the authenticated user's profile information including display name, avatar URLs, and email (if authorized).",
    {
      fields: z
        .array(z.enum(['open_id', 'display_name', 'avatar_url_50x50', 'avatar_url_100x100', 'avatar_url_720x720', 'email'] as const))
        .optional()
        .describe('Fields to retrieve. Default: ["open_id", "display_name", "avatar_url_50x50"]'),
    },
    async ({ fields }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
        }

        const now = Date.now();
        const expiresAt = storedTokens.expires_at || 0;
        if (now > expiresAt) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
        }

        const requestedFields: UserInfoField[] = fields?.length ? fields : ['open_id', 'display_name', 'avatar_url_50x50'];
        const grantedScopes = storedTokens.scope || [];
        const hasEmailScope = grantedScopes.includes('user.info.email');
        const filteredFields = requestedFields.filter(field => field !== 'email' || hasEmailScope);

        logger.info('Fetching user info', { fields: filteredFields });

        const userInfo = await loginKitClient.getUserInfo(storedTokens.access_token, filteredFields);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { user_info: userInfo, avatar_urls: { thumbnail_50x50: loginKitClient.getAvatarUrl(userInfo, 50), medium_100x100: loginKitClient.getAvatarUrl(userInfo, 100), high_res_720x720: loginKitClient.getAvatarUrl(userInfo, 720) } } }, null, 2) }] };
      } catch (error) {
        logger.error('Get user info failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'GET_USER_INFO_FAILED', message: `Failed to get user info: ${error}` } }, null, 2) }] };
      }
    },
  );
}
