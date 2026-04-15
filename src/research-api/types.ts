/**
 * Phase 5: Research API Types
 * 
 * TikTok Research API enables SQL-like queries for TikTok data analysis.
 * - Query video metadata, engagement metrics, creator info
 * - Filter by date ranges, hashtags, creators
 * - Aggregate statistics and trends
 */

// ============================================================================
// Query Parameters
// ============================================================================

/** Field names available for Research API queries */
export type ResearchField = 
  | 'video_id'
  | 'create_time'
  | 'desc'
  | 'author_openid'
  | 'author_unique_id'
  | 'author_name'
  | 'statistics_digg_count'
  | 'statistics_share_count'
  | 'statistics_comment_count'
  | 'statistics_play_count'
  | 'video_duration'
  | 'music_id'
  | 'music_title'
  | 'hashtags';

/** Request body for Research API query */
export interface ResearchQueryRequest {
  sql: string;                              // SQL-like query string
  fields?: ResearchField[];                 // Fields to return (optional)
}

/** Response from Research API query */
export interface ResearchQueryResponseData {
  data: Record<string, unknown>[];          // Query results as array of objects
  total_count: number;                     // Total matching records
  has_more: boolean;                       // Whether more results exist
  cursor?: string;                         // Cursor for pagination
}

// ============================================================================
// Video Data Structure (Research API)
// ============================================================================

/** Video data structure as returned by Research API */
export interface ResearchVideoData {
  video_id: string;
  create_time: number;                      // Unix timestamp
  desc: string;
  author_openid: string;
  author_unique_id: string;                 // Username
  author_name: string;                     // Display name
  statistics_digg_count: number;
  statistics_share_count: number;
  statistics_comment_count: number;
  statistics_play_count: number;
  video_duration: number;                   // Duration in seconds
  music_id?: string;
  music_title?: string;
  hashtags?: string[];
}

// ============================================================================
// Aggregation Types
// ============================================================================

/** Aggregation function names */
export type AggregateFunction = 
  | 'COUNT'
  | 'SUM'
  | 'AVG'
  | 'MIN'
  | 'MAX';

/** Request for aggregation query */
export interface ResearchAggregateRequest {
  sql: string;                              // SQL-like aggregation query
}

/** Response from aggregation query */
export interface ResearchAggregateResponseData {
  data: Record<string, number>[];           // Aggregated results
}

// ============================================================================
// Time Range Filter
// ============================================================================

/** Time range filter for queries */
export interface TimeRangeFilter {
  start_time: number;                       // Unix timestamp (start)
  end_time: number;                         // Unix timestamp (end)
}

// ============================================================================
// Common SQL Query Templates
// ============================================================================

/** Pre-built query templates for common operations */
export const QUERY_TEMPLATES = {
  /** Get videos by hashtag within time range */
  BY_HASHTAG: `
    SELECT video_id, create_time, desc, author_unique_id, 
           statistics_digg_count, statistics_play_count
    WHERE hashtags LIKE '%{hashtag}%'
      AND create_time >= {start_time}
      AND create_time <= {end_time}
    ORDER BY create_time DESC
    LIMIT {limit}
  `,
  
  /** Get videos by creator within time range */
  BY_CREATOR: `
    SELECT video_id, create_time, desc, statistics_digg_count,
           statistics_share_count, statistics_comment_count, statistics_play_count
    WHERE author_unique_id = '{username}'
      AND create_time >= {start_time}
      AND create_time <= {end_time}
    ORDER BY create_time DESC
    LIMIT {limit}
  `,
  
  /** Get top videos by engagement */
  TOP_BY_ENGAGEMENT: `
    SELECT video_id, create_time, desc, author_unique_id,
           statistics_digg_count, statistics_play_count
    WHERE create_time >= {start_time}
      AND create_time <= {end_time}
    ORDER BY (statistics_digg_count + statistics_share_count * 2) DESC
    LIMIT {limit}
  `,
  
  /** Get videos with high play count */
  TOP_BY_PLAYS: `
    SELECT video_id, create_time, desc, author_unique_id,
           statistics_play_count, statistics_digg_count
    WHERE statistics_play_count >= {min_plays}
      AND create_time >= {start_time}
      AND create_time <= {end_time}
    ORDER BY statistics_play_count DESC
    LIMIT {limit}
  `,
} as const;

// ============================================================================
// Constants
// ============================================================================

/** Maximum limit for Research API queries */
export const MAX_QUERY_LIMIT = 100;

/** Default limit for Research API queries */
export const DEFAULT_QUERY_LIMIT = 20;
