/**
 * Research API tool handlers (Phase 5).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TokenStorage } from '../core/types.js';
import { tokenManager } from '../auth/token-manager.js';
import { ResearchAPIClient } from '../research-api/client.js';
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

export function registerResearchApiHandlers(server: McpServer): void {
  // --- tiktok_research_query ---
  server.tool(
    'tiktok_research_query',
    "Execute a SQL-like query against TikTok's research database. Supports SELECT, WHERE, ORDER BY, LIMIT.",
    {
      sql: z.string().describe('SQL-like query string'),
    },
    async ({ sql }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Executing research query', { sql });

        const client = new ResearchAPIClient(storedTokens.access_token);
        const result = await client.executeQuery({ sql });

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { results: result.data, total_count: result.total_count, has_more: result.has_more, cursor: result.cursor } }, null, 2) }] };
      } catch (error) {
        logger.error('Research query failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'RESEARCH_QUERY_FAILED', message: `Failed to execute query: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_research_query_by_hashtag ---
  server.tool(
    'tiktok_research_query_by_hashtag',
    'Query videos by hashtag within a time range.',
    {
      hashtag: z.string().describe('Hashtag to search for (without #)'),
      days_ago: z.number().int().min(1).max(90).optional().default(7).describe('Look back this many days (1-90, default: 7)'),
      limit: z.number().int().min(1).max(100).optional().default(20).describe('Max results to return (1-100, default: 20)'),
    },
    async ({ hashtag, days_ago, limit }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Querying by hashtag', { hashtag, days_ago });

        const client = new ResearchAPIClient(storedTokens.access_token);
        const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
        const result = await client.queryByHashtag(hashtag, timeRange, limit);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { videos: result.data, total_count: result.total_count, has_more: result.has_more } }, null, 2) }] };
      } catch (error) {
        logger.error('Query by hashtag failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'QUERY_BY_HASHTAG_FAILED', message: `Failed to query by hashtag: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_research_top_by_engagement ---
  server.tool(
    'tiktok_research_top_by_engagement',
    'Get top videos by engagement (likes + shares) within a time range.',
    {
      days_ago: z.number().int().min(1).max(90).optional().default(7).describe('Look back this many days'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ days_ago, limit }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Getting top by engagement', { days_ago });

        const client = new ResearchAPIClient(storedTokens.access_token);
        const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
        const result = await client.queryTopByEngagement(timeRange, limit);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { videos: result.data, total_count: result.total_count } }, null, 2) }] };
      } catch (error) {
        logger.error('Top by engagement failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOP_BY_ENGAGEMENT_FAILED', message: `Failed to get top videos: ${error}` } }, null, 2) }] };
      }
    },
  );

  // --- tiktok_research_count_by_hashtag ---
  server.tool(
    'tiktok_research_count_by_hashtag',
    'Count total videos for a hashtag within a time range.',
    {
      hashtag: z.string().describe('Hashtag to count (without #)'),
      days_ago: z.number().int().min(1).max(90).optional().default(7),
    },
    async ({ hashtag, days_ago }) => {
      try {
        const storedTokens = await tokenManager.getTokens();

        if (!storedTokens?.access_token) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' } }, null, 2) }] };
        }

        const now = Date.now();
        if (now > (storedTokens.expires_at || 0)) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' } }, null, 2) }] };
        }

        logger.info('Counting by hashtag', { hashtag });

        const client = new ResearchAPIClient(storedTokens.access_token);
        const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
        const result = await client.countByHashtag(hashtag, timeRange);

        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { hashtag, count: result.count, period_days: days_ago } }, null, 2) }] };
      } catch (error) {
        logger.error('Count by hashtag failed', { error });
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'COUNT_BY_HASHTAG_FAILED', message: `Failed to count: ${error}` } }, null, 2) }] };
      }
    },
  );
}
