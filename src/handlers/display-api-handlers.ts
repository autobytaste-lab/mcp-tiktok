/**
 * Display API tool handlers (Phase 3).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../core/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { DisplayAPIClient } from '../display-api/client.js';
import { logger } from '../utils/logger.js';

const displayAPIClient = new DisplayAPIClient();

function formatVideo(video: any): any {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    cover_url: video.cover_url,
    play_url: video.play_url,
    duration: video.duration,
    create_time: new Date(video.create_time * 1000).toISOString(),
    author: {
      id: video.author.id,
      username: video.author.unique_id,
      nickname: video.author.nickname,
      avatar_url: video.author.avatar_url,
    },
    stats: {
      plays: displayAPIClient.formatNumber(video.stats.play_count),
      likes: displayAPIClient.formatNumber(video.stats.like_count),
      comments: displayAPIClient.formatNumber(video.stats.comment_count),
      shares: displayAPIClient.formatNumber(video.stats.share_count),
    },
    hashtags: video.hashtags,
    music: {
      title: video.music.title,
      author: video.music.author,
      duration: video.music.duration,
    },
  };
}

function authCheck(tokens: TokenStorage): { content: Array<{ type: 'text'; text: string }> } | null {
  if (!tokens?.access_token) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
  }
  const now = Date.now();
  if (now > (tokens.expires_at || 0)) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
  }
  const grantedScopes = tokens.scope || [];
  if (!grantedScopes.includes('video.list')) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_SCOPE', message: 'The video.list scope is required for this operation. Please re-authenticate with the video.list scope.' } }, null, 2) }] };
  }
  return null;
}

export function registerDisplayApiHandlers(server: McpServer): void {
  // --- tiktok_display_query_videos ---
  server.tool(
    'tiktok_display_query_videos',
    'Search for TikTok videos by keyword or hashtag. Returns video metadata including title, cover URL, play count, etc.',
    {
      keyword: z.string().min(1).max(100).describe('Search keyword or hashtag (without # symbol)'),
      max_count: z.number().int().min(1).max(20).optional().default(10).describe('Maximum number of results to return (1-20, default: 10)'),
      cursor: z.number().int().min(0).optional().default(0).describe('Pagination cursor for fetching more results'),
    },
    async ({ keyword, max_count, cursor }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
        }

        const grantedScopes = storedTokens.scope || [];
        if (!grantedScopes.includes('video.list')) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_SCOPE', message: 'The video.list scope is required for this operation. Please re-authenticate with the video.list scope.' } }, null, 2) }] };
        }

        logger.info('Querying videos', { keyword, max_count, cursor });

        const response = await displayAPIClient.queryVideos(storedTokens.access_token, { keyword, max_count, cursor });

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { videos: response.data.videos.map(formatVideo), pagination: { cursor: response.data.cursor, has_more: response.data.has_more, total_returned: response.data.videos.length } } }, null, 2) }] };
      } catch (error) {
        logger.error('Query videos failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'QUERY_VIDEOS_FAILED', message: `Failed to query videos: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_display_list_videos ---
  server.tool(
    'tiktok_display_list_videos',
    "List the authenticated user's recent videos. Requires video.list scope.",
    {
      max_count: z.number().int().min(1).max(20).optional().default(10).describe('Maximum number of results to return (1-20, default: 10)'),
      cursor: z.number().int().min(0).optional().default(0).describe('Pagination cursor for fetching more results'),
    },
    async ({ max_count, cursor }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
        }

        const grantedScopes = storedTokens.scope || [];
        if (!grantedScopes.includes('video.list')) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'MISSING_SCOPE', message: 'The video.list scope is required for this operation. Please re-authenticate with the video.list scope.' } }, null, 2) }] };
        }

        logger.info('Listing user videos', { open_id: storedTokens.open_id });

        const response = await displayAPIClient.listVideos(storedTokens.access_token, { open_id: storedTokens.open_id, max_count, cursor });

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { videos: response.data.videos.map(formatVideo), pagination: { cursor: response.data.cursor, has_more: response.data.has_more, total_returned: response.data.videos.length } } }, null, 2) }] };
      } catch (error) {
        logger.error('List videos failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'LIST_VIDEOS_FAILED', message: `Failed to list videos: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_display_get_user_info ---
  server.tool(
    'tiktok_display_get_user_info',
    "Get TikTok user profile information by their open_id. Requires user.info.basic scope.",
    {
      open_id: z.string().describe("The user's open_id to look up"),
    },
    async ({ open_id }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
        }

        logger.info('Getting user info', { open_id });

        const userInfo = await displayAPIClient.getUserInfo(storedTokens.access_token, open_id);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { user_info: { open_id: userInfo.open_id, display_name: userInfo.display_name, avatar_urls: { thumbnail_50x50: userInfo.avatar_url_50x50, medium_100x100: userInfo.avatar_url_100x100, high_res_720x720: userInfo.avatar_url_720x720 } } } }, null, 2) }] };
      } catch (error) {
        logger.error('Get user info failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'GET_USER_INFO_FAILED', message: `Failed to get user info: ${error}` } }, null, 2) }] };
      }
    },
  );
}
