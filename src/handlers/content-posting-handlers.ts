/**
 * Content Posting tool handlers (Phase 4).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../core/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { ContentPostingClient, sleep } from '../content-posting/client.js';
import { logger } from '../utils/logger.js';

function authCheck(tokens: TokenStorage): { content: Array<{ type: 'text'; text: string }> } | null {
  if (!tokens?.access_token) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.' } }, null, 2) }] };
  }
  const now = Date.now();
  if (now > (tokens.expires_at || 0)) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh using tiktok_refresh_token.' } }, null, 2) }] };
  }
  return null;
}

export function registerContentPostingHandlers(server: McpServer): void {
  // --- tiktok_posting_get_creator_info ---
  server.tool(
    'tiktok_posting_get_creator_info',
    "Query the authenticated creator's posting capabilities including available privacy levels, max video duration, and restrictions.",
    {},
    async () => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Getting creator info');
        const creatorInfo = await new ContentPostingClient(storedTokens.access_token).getCreatorInfo();

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { creator_info: { avatar_url: creatorInfo.creator_avatar_url, username: creatorInfo.creator_username, nickname: creatorInfo.creator_nickname, privacy_levels_available: creatorInfo.privacy_level_options, max_video_duration_seconds: creatorInfo.max_video_post_duration_sec, restrictions: { comments_disabled: creatorInfo.comment_disabled, duet_disabled: creatorInfo.duet_disabled, stitch_disabled: creatorInfo.stitch_disabled } } } }, null, 2) }] };
      } catch (error) {
        logger.error('Get creator info failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'GET_CREATOR_INFO_FAILED', message: `Failed to get creator info: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_posting_post_video ---
  server.tool(
    'tiktok_posting_post_video',
    'Post a video to TikTok. Supports PULL_FROM_URL (TikTok downloads from verified domain) or FILE_UPLOAD (local file).',
    {
      title: z.string().max(2200).describe('Video caption/title (max 2200 chars)'),
      privacy_level: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).describe('Visibility level'),
      video_url: z.string().url().optional().describe('Video URL from verified domain (PULL_FROM_URL)'),
      video_path: z.string().optional().describe('Local file path for upload (FILE_UPLOAD)'),
      post_mode: z.enum(['DIRECT_POST', 'MEDIA_UPLOAD']).optional().default('DIRECT_POST').describe('DIRECT_POST=publish now, MEDIA_UPLOAD=send to inbox'),
      disable_duet: z.boolean().optional().default(false),
      disable_comment: z.boolean().optional().default(false),
      disable_stitch: z.boolean().optional().default(false),
    },
    async ({ title, privacy_level, video_url, video_path, post_mode, disable_duet, disable_comment, disable_stitch }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        if (!video_url && !video_path) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'INVALID_PARAMS', message: 'Provide either video_url or video_path' } }, null, 2) }] };
        }

        logger.info('Posting video', { mode: post_mode, source: video_url ? 'PULL_FROM_URL' : 'FILE_UPLOAD' });

        const client = new ContentPostingClient(storedTokens.access_token);

        if (video_url) {
          const result = await client.initVideoPost({
            post_info: { title, privacy_level, disable_duet, disable_comment, disable_stitch },
            source_info: { source: 'PULL_FROM_URL', video_url },
          });

          return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { publish_id: result.publish_id, source: 'PULL_FROM_URL', post_mode, message: 'Video post initiated. Use tiktok_posting_check_status to track progress.' } }, null, 2) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_IMPLEMENTED', message: 'FILE_UPLOAD requires additional setup. Use PULL_FROM_URL instead.' } }, null, 2) }] };
      } catch (error) {
        logger.error('Post video failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'POST_VIDEO_FAILED', message: `Failed to post video: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_posting_post_images ---
  server.tool(
    'tiktok_posting_post_images',
    'Post a photo or carousel (up to 35 images) to TikTok. Images must be from verified domains.',
    {
      title: z.string().max(2200).describe('Caption/title'),
      privacy_level: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).describe('Visibility level'),
      image_urls: z.array(z.string().url()).min(1).max(35).describe('Image URLs from verified domain (1-35 images)'),
      photo_cover_index: z.number().int().min(1).optional().default(1).describe('Cover image index (1-based, default: 1)'),
      post_mode: z.enum(['DIRECT_POST', 'MEDIA_UPLOAD']).optional().default('DIRECT_POST'),
      description: z.string().optional().describe('Extended description'),
      disable_comment: z.boolean().optional().default(false),
    },
    async ({ title, privacy_level, image_urls, photo_cover_index, post_mode, description, disable_comment }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Posting images', { count: image_urls.length });

        const client = new ContentPostingClient(storedTokens.access_token);
        const result = await client.initPhotoPost({
          post_info: { title, privacy_level, disable_comment, auto_add_music: true, ...(description && { description }) },
          source_info: { source: 'PULL_FROM_URL', photo_cover_index, photo_images: image_urls },
          post_mode,
          media_type: 'PHOTO',
        });

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { publish_id: result.publish_id, image_count: image_urls.length, cover_index: photo_cover_index, post_mode, message: 'Photo post initiated. Use tiktok_posting_check_status to track progress.' } }, null, 2) }] };
      } catch (error) {
        logger.error('Post images failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'POST_IMAGES_FAILED', message: `Failed to post images: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_posting_check_status ---
  server.tool(
    'tiktok_posting_check_status',
    'Check the current publish status of a post by publish_id.',
    {
      publish_id: z.string().describe('Publish ID from post_video or post_images'),
    },
    async ({ publish_id }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Checking post status', { publish_id });

        const client = new ContentPostingClient(storedTokens.access_token);
        const status = await client.getPublishStatus(publish_id);

        const note = status.status === 'PUBLISH_COMPLETE' ? 'Content is now live on TikTok.' : status.status === 'FAILED' ? `Post failed. Reason: ${status.fail_reason || 'unknown'}` : 'Still processing...';

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { publish_id, status: status.status, fail_reason: status.fail_reason, post_ids: status.publicaly_available_post_id, note } }, null, 2) }] };
      } catch (error) {
        logger.error('Check status failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'CHECK_STATUS_FAILED', message: `Failed to check status: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_posting_wait_for_post ---
  server.tool(
    'tiktok_posting_wait_for_post',
    'Poll publish status repeatedly until PUBLISH_COMPLETE, FAILED, or timeout.',
    {
      publish_id: z.string().describe('Publish ID to poll'),
      timeout_seconds: z.number().int().min(10).max(600).optional().default(120).describe('Max seconds to wait (default 120, max 600)'),
      poll_interval_seconds: z.number().int().min(3).max(30).optional().default(5).describe('Seconds between checks (default 5)'),
    },
    async ({ publish_id, timeout_seconds, poll_interval_seconds }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        const client = new ContentPostingClient(storedTokens.access_token);
        const timeoutMs = timeout_seconds * 1000;
        const intervalMs = poll_interval_seconds * 1000;
        const deadline = Date.now() + timeoutMs;
        let attempts = 0;

        while (Date.now() < deadline) {
          attempts++;
          const status = await client.getPublishStatus(publish_id);

          if (status.status === 'PUBLISH_COMPLETE') {
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { publish_id, status: 'PUBLISH_COMPLETE', attempts, post_ids: status.publicaly_available_post_id, note: 'Content is now live on TikTok.' } }) }] };
          }

          if (status.status === 'FAILED') {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, data: { publish_id, status: 'FAILED', attempts, fail_reason: status.fail_reason || 'unknown' } }) }] };
          }

          const waitMs = Math.min(intervalMs, deadline - Date.now());
          if (waitMs > 0) await sleep(waitMs);
        }

        return { content: [{ type: 'text', text: JSON.stringify({ success: false, data: { publish_id, status: 'TIMEOUT', attempts, note: `Still processing after ${timeout_seconds}s. Call tiktok_posting_check_status to continue monitoring.` } }) }] };
      } catch (error) {
        logger.error('Wait for post failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'WAIT_FOR_POST_FAILED', message: `Failed to wait for post: ${error}` } }, null, 2) }] };
      }
    },
  );
}
