/**
 * Phase 3: Display API Client
 * 
 * TikTok Display API enables querying and displaying public video content.
 * - Query videos by keyword/hashtag
 * - List a user's recent videos
 * - Get detailed video information
 */

import { OAuthError } from '../core/errors.js';
import type {
  VideoQueryResponse,
  VideoListResponse,
  UserInfoResponse,
  TikTokVideo,
  UserProfile,
  VideoQueryParams,
  VideoListParams,
} from './types.js';

/**
 * Display API Client for querying videos and user profiles
 */
export class DisplayAPIClient {
  // API Endpoints
  private readonly QUERY_VIDEOS_URL = 'https://open.tiktokapis.com/v2/video/query/';
  private readonly LIST_VIDEOS_URL = 'https://open.tiktokapis.com/v2/video/list/';
  private readonly GET_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

  /**
   * Query videos by keyword or hashtag
   * 
   * @param accessToken - Valid access token with video.list scope
   * @param params - Query parameters including keyword
   * @returns Video query response with pagination info
   */
  async queryVideos(
    accessToken: string,
    params: VideoQueryParams
  ): Promise<VideoQueryResponse> {
    const { keyword, max_count = 10, cursor = 0 } = params;

    // Validate parameters
    if (!keyword || keyword.trim().length === 0) {
      throw new OAuthError(
        'Keyword is required for video query',
        'MISSING_KEYWORD'
      );
    }

    if (max_count < 1 || max_count > 20) {
      throw new OAuthError(
        'max_count must be between 1 and 20',
        'INVALID_MAX_COUNT'
      );
    }

    try {
      const response = await fetch(this.QUERY_VIDEOS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keyword: keyword.trim(),
          max_count,
          cursor,
        }),
      });

      const data = await response.json() as VideoQueryResponse;

      if (!response.ok || data.code !== 0) {
        throw new OAuthError(
          data.msg || `HTTP ${response.status}: ${response.statusText}`,
          data.log_id || 'UNKNOWN_ERROR',
          response.status
        );
      }

      return data;
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      
      throw new OAuthError(
        `Failed to query videos: ${error instanceof Error ? error.message : String(error)}`,
        'VIDEO_QUERY_FAILED'
      );
    }
  }

  /**
   * List a user's recent videos
   * 
   * @param accessToken - Valid access token with video.list scope
   * @param params - Parameters including user's open_id
   * @returns Video list response with pagination info
   */
  async listVideos(
    accessToken: string,
    params: VideoListParams
  ): Promise<VideoListResponse> {
    const { open_id, max_count = 10, cursor = 0 } = params;

    // Validate parameters
    if (!open_id || open_id.trim().length === 0) {
      throw new OAuthError(
        'open_id is required for listing videos',
        'MISSING_OPEN_ID'
      );
    }

    if (max_count < 1 || max_count > 20) {
      throw new OAuthError(
        'max_count must be between 1 and 20',
        'INVALID_MAX_COUNT'
      );
    }

    try {
      const response = await fetch(this.LIST_VIDEOS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          open_id: open_id.trim(),
          max_count,
          cursor,
        }),
      });

      const data = await response.json() as VideoListResponse;

      if (!response.ok || data.code !== 0) {
        throw new OAuthError(
          data.msg || `HTTP ${response.status}: ${response.statusText}`,
          data.log_id || 'UNKNOWN_ERROR',
          response.status
        );
      }

      return data;
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      
      throw new OAuthError(
        `Failed to list videos: ${error instanceof Error ? error.message : String(error)}`,
        'VIDEO_LIST_FAILED'
      );
    }
  }

  /**
   * Get user profile information
   * 
   * @param accessToken - Valid access token with user.info.basic scope
   * @param openId - The user's open_id to look up
   * @returns User profile information
   */
  async getUserInfo(
    accessToken: string,
    openId: string
  ): Promise<UserProfile> {
    if (!openId || openId.trim().length === 0) {
      throw new OAuthError(
        'open_id is required for getting user info',
        'MISSING_OPEN_ID'
      );
    }

    try {
      const response = await fetch(this.GET_USER_INFO_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          open_id: openId.trim(),
        }),
      });

      const data = await response.json() as UserInfoResponse;

      if (!response.ok || data.code !== 0) {
        throw new OAuthError(
          data.msg || `HTTP ${response.status}: ${response.statusText}`,
          data.log_id || 'UNKNOWN_ERROR',
          response.status
        );
      }

      return data.data;
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      
      throw new OAuthError(
        `Failed to get user info: ${error instanceof Error ? error.message : String(error)}`,
        'GET_USER_INFO_FAILED'
      );
    }
  }

  /**
   * Get detailed information about a specific video
   * 
   * Note: This uses queryVideos with the video ID as keyword since TikTok
   * doesn't have a dedicated "get video by ID" endpoint in Display API.
   * 
   * @param accessToken - Valid access token with video.list scope
   * @param videoId - The video ID to look up
   * @returns Video details if found, null otherwise
   */
  async getVideoDetail(
    accessToken: string,
    videoId: string
  ): Promise<TikTokVideo | null> {
    if (!videoId || videoId.trim().length === 0) {
      throw new OAuthError(
        'video_id is required',
        'MISSING_VIDEO_ID'
      );
    }

    try {
      // Query with video ID as keyword (best available option)
      const response = await this.queryVideos(accessToken, {
        keyword: videoId.trim(),
        max_count: 1,
      });

      if (response.data.videos.length > 0) {
        return response.data.videos[0];
      }

      return null;
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error;
      }
      
      throw new OAuthError(
        `Failed to get video detail: ${error instanceof Error ? error.message : String(error)}`,
        'GET_VIDEO_DETAIL_FAILED'
      );
    }
  }

  /**
   * Format video stats for display (e.g., "1.2M", "45.5K")
   */
  formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  /**
   * Format video duration from seconds to MM:SS format
   */
  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}