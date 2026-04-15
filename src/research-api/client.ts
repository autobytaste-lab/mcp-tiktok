/**
 * Phase 5: Research API Client
 * 
 * TikTok Research API enables SQL-like queries for TikTok data analysis.
 */

import axios, { isAxiosError } from 'axios';
import type {
  ResearchQueryRequest,
  ResearchQueryResponseData,
  ResearchAggregateRequest,
  ResearchAggregateResponseData,
  TimeRangeFilter,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://open.tiktokapis.com';
const REQUEST_TIMEOUT = 60_000; // 60 seconds for research queries

// ============================================================================
// Error Helpers
// ============================================================================

function extractMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const body = err.response?.data;
    const prefix = status ? `HTTP ${status}: ` : '';
    if (body?.error?.message) return `${prefix}${body.error.code} – ${body.error.message}`;
    if (body?.error_description) return `${prefix}${String(body.error_description)}`;
    return `${prefix}${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function assertOk(error: { code: string; message?: string }): void {
  if (error.code !== 'ok') {
    throw new Error(`TikTok API error [${error.code}]: ${error.message || 'Unknown error'}`);
  }
}

// ============================================================================
// ResearchAPIClient
// ============================================================================

export class ResearchAPIClient {
  constructor(private readonly accessToken?: string) {}

  private requireToken(): string {
    if (!this.accessToken) throw new Error('An access_token is required for this operation.');
    return this.accessToken;
  }

  private async apiPost<T>(path: string, body: unknown, token: string): Promise<T> {
    try {
      const res = await axios.post<{ data: T; error: { code: string; message?: string } }>(
        `${API_BASE}${path}`,
        body,
        {
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${token}`,
          },
          timeout: REQUEST_TIMEOUT,
        }
      );
      assertOk(res.data.error);
      return res.data.data;
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(extractMessage(err));
    }
  }

  // ========================================================================
  // Query Execution
  // ========================================================================

  /**
   * Execute a SQL-like query against TikTok's research database.
   * 
   * @param sql - SQL-like query string
   * @param fields - Optional list of fields to return
   */
  async executeQuery(
    request: ResearchQueryRequest
  ): Promise<ResearchQueryResponseData> {
    return this.apiPost<ResearchQueryResponseData>(
      '/v2/research/query/',
      request,
      this.requireToken()
    );
  }

  /**
   * Execute an aggregation query.
   */
  async executeAggregation(
    request: ResearchAggregateRequest
  ): Promise<ResearchAggregateResponseData> {
    return this.apiPost<ResearchAggregateResponseData>(
      '/v2/research/aggregate/',
      request,
      this.requireToken()
    );
  }

  // ========================================================================
  // Convenience Methods (High-Level Queries)
  // ========================================================================

  /**
   * Query videos by hashtag within a time range.
   */
  async queryByHashtag(
    hashtag: string,
    timeRange: TimeRangeFilter,
    limit: number = 20
  ): Promise<ResearchQueryResponseData> {
    const sql = `
      SELECT video_id, create_time, desc, author_unique_id, 
             statistics_digg_count, statistics_share_count, 
             statistics_comment_count, statistics_play_count
      WHERE hashtags LIKE '%${hashtag}%'
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
      ORDER BY create_time DESC
      LIMIT ${Math.min(limit, 100)}
    `;
    
    return this.executeQuery({ sql });
  }

  /**
   * Query videos by creator username within a time range.
   */
  async queryByCreator(
    username: string,
    timeRange: TimeRangeFilter,
    limit: number = 20
  ): Promise<ResearchQueryResponseData> {
    const sql = `
      SELECT video_id, create_time, desc, 
             statistics_digg_count, statistics_share_count, 
             statistics_comment_count, statistics_play_count
      WHERE author_unique_id = '${username}'
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
      ORDER BY create_time DESC
      LIMIT ${Math.min(limit, 100)}
    `;
    
    return this.executeQuery({ sql });
  }

  /**
   * Get top videos by engagement (likes + shares) within a time range.
   */
  async queryTopByEngagement(
    timeRange: TimeRangeFilter,
    limit: number = 20
  ): Promise<ResearchQueryResponseData> {
    const sql = `
      SELECT video_id, create_time, desc, author_unique_id,
             statistics_digg_count, statistics_share_count, 
             statistics_play_count
      WHERE create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
      ORDER BY (statistics_digg_count + statistics_share_count * 2) DESC
      LIMIT ${Math.min(limit, 100)}
    `;
    
    return this.executeQuery({ sql });
  }

  /**
   * Get top videos by play count within a time range.
   */
  async queryTopByPlays(
    timeRange: TimeRangeFilter,
    minPlays: number = 10000,
    limit: number = 20
  ): Promise<ResearchQueryResponseData> {
    const sql = `
      SELECT video_id, create_time, desc, author_unique_id,
             statistics_play_count, statistics_digg_count
      WHERE statistics_play_count >= ${minPlays}
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
      ORDER BY statistics_play_count DESC
      LIMIT ${Math.min(limit, 100)}
    `;
    
    return this.executeQuery({ sql });
  }

  /**
   * Get videos with high engagement rate.
   */
  async queryHighEngagementVideos(
    timeRange: TimeRangeFilter,
    minEngagementRate: number = 0.05, // 5% default
    limit: number = 20
  ): Promise<ResearchQueryResponseData> {
    const sql = `
      SELECT video_id, create_time, desc, author_unique_id,
             statistics_digg_count, statistics_play_count,
             (statistics_digg_count * 1.0 / statistics_play_count) as engagement_rate
      WHERE statistics_play_count > 1000
        AND (statistics_digg_count * 1.0 / statistics_play_count) >= ${minEngagementRate}
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
      ORDER BY engagement_rate DESC
      LIMIT ${Math.min(limit, 100)}
    `;
    
    return this.executeQuery({ sql });
  }

  // ========================================================================
  // Aggregation Convenience Methods
  // ========================================================================

  /**
   * Count videos by hashtag within a time range.
   */
  async countByHashtag(
    hashtag: string,
    timeRange: TimeRangeFilter
  ): Promise<{ count: number }> {
    const sql = `
      SELECT COUNT(*) as count
      WHERE hashtags LIKE '%${hashtag}%'
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
    `;
    
    const result = await this.executeAggregation({ sql });
    return { count: result.data[0]?.count || 0 };
  }

  /**
   * Get total plays for videos by hashtag within a time range.
   */
  async sumPlaysByHashtag(
    hashtag: string,
    timeRange: TimeRangeFilter
  ): Promise<{ total_plays: number }> {
    const sql = `
      SELECT SUM(statistics_play_count) as total_plays
      WHERE hashtags LIKE '%${hashtag}%'
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
    `;
    
    const result = await this.executeAggregation({ sql });
    return { total_plays: result.data[0]?.total_plays || 0 };
  }

  /**
   * Get average engagement rate for videos within a time range.
   */
  async avgEngagementRate(
    timeRange: TimeRangeFilter
  ): Promise<{ avg_engagement_rate: number }> {
    const sql = `
      SELECT AVG(statistics_digg_count * 1.0 / statistics_play_count) as avg_engagement_rate
      WHERE statistics_play_count > 0
        AND create_time >= ${timeRange.start_time}
        AND create_time <= ${timeRange.end_time}
    `;
    
    const result = await this.executeAggregation({ sql });
    return { avg_engagement_rate: result.data[0]?.avg_engagement_rate || 0 };
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Generate a time range filter for the last N days.
   */
  static createTimeRangeForLastDays(days: number): TimeRangeFilter {
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    return {
      start_time: Math.floor(start / 1000),
      end_time: Math.floor(now / 1000),
    };
  }

  /**
   * Generate a time range filter for a specific date range.
   */
  static createTimeRangeFromDate(startDate: Date, endDate: Date): TimeRangeFilter {
    return {
      start_time: Math.floor(startDate.getTime() / 1000),
      end_time: Math.floor(endDate.getTime() / 1000),
    };
  }
}
