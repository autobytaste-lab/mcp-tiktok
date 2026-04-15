/**
 * Phase 3: Display API Types
 * 
 * TikTok Display API allows you to query and display public video content
 * from TikTok, including user profiles and video information.
 */

/**
 * Scopes required for Display API
 */
export const DISPLAY_API_SCOPES = [
  'video.list', // Required for querying videos
] as const;

export type DisplayApiScope = typeof DISPLAY_API_SCOPES[number];

/**
 * Video author information
 */
export interface VideoAuthor {
  id: string;           // User ID
  unique_id: string;    // Username
  nickname: string;     // Display name
  avatar_url: string;   // Avatar URL
}

/**
 * Video statistics
 */
export interface VideoStats {
  play_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  download_count?: number;
}

/**
 * Music/sound information attached to a video
 */
export interface VideoMusic {
  id: string;
  title: string;
  author: string;       // Artist name
  duration: number;     // Duration in seconds
  album?: string;
}

/**
 * Complete TikTok video object
 */
export interface TikTokVideo {
  id: string;           // Video ID
  title: string;        // Video title
  description?: string; // Video description/caption
  
  // URLs
  cover_url: string;    // Thumbnail/cover image URL
  play_url: string;     // Direct video playback URL
  download_url?: string;// Download URL (if available)
  
  // Metadata
  duration: number;     // Duration in seconds
  create_time: number;  // Unix timestamp when created
  update_time?: number; // Unix timestamp when last updated
  
  // Content details
  author: VideoAuthor;
  stats: VideoStats;
  hashtags: string[];   // Hashtags used in video
  music: VideoMusic;
  
  // Additional fields
  region_code?: string; // Country code (e.g., "US", "CA")
  video_quality?: 'HD' | 'SD';
  is_ad?: boolean;      // Whether this is a sponsored video
}

/**
 * Response from video query endpoint
 */
export interface VideoQueryResponse {
  code: number;
  msg: string;
  log_id: string;
  data: {
    cursor: number;     // Cursor for pagination
    has_more: boolean;  // Whether more results exist
    search_id?: string; // Search session ID
    videos: TikTokVideo[];
  };
}

/**
 * Response from video list endpoint (user's videos)
 */
export interface VideoListResponse {
  code: number;
  msg: string;
  log_id: string;
  data: {
    cursor: number;
    has_more: boolean;
    videos: TikTokVideo[];
  };
}

/**
 * User profile information from Display API
 */
export interface UserProfile {
  open_id: string;      // User's unique ID
  display_name?: string;// Display name (requires user.info.basic)
  avatar_url_50x50?: string;
  avatar_url_100x100?: string;
  avatar_url_720x720?: string;
}

/**
 * Response from user info endpoint
 */
export interface UserInfoResponse {
  code: number;
  msg: string;
  log_id: string;
  data: UserProfile;
}

/**
 * Parameters for querying videos by keyword
 */
export interface VideoQueryParams {
  keyword: string;      // Search keyword (required)
  max_count?: number;   // Max results per page (default: 10, max: 20)
  cursor?: number;      // Pagination cursor (default: 0)
}

/**
 * Parameters for listing user's videos
 */
export interface VideoListParams {
  open_id: string;     // User's open_id (required)
  max_count?: number;  // Max results per page (default: 10, max: 20)
  cursor?: number;     // Pagination cursor (default: 0)
}

/**
 * Parameters for getting user info
 */
export interface GetUserInfoParams {
  open_id: string;     // User's open_id (required)
}