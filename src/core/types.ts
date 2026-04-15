/**
 * Shared TypeScript types for MCP-TikTok
 */

// OAuth Types
export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string[];
  token_type?: 'Bearer';
}

export interface OAuthResponse extends OAuthTokens {
  open_id: string;
}

export interface TokenStorage extends OAuthTokens {
  open_id: string;
  client_key: string;
  expires_at: number; // Unix timestamp
  created_at: number;
}

// User Info Types
export interface TikTokUserInfo {
  open_id: string;
  display_name?: string;
  avatar_url_50x50?: string;
  avatar_url_100x100?: string;
  avatar_url_720x720?: string;
  email?: string; // Requires user.info.email scope
}

// Display API Types
export interface TikTokVideo {
  id: string;
  title: string;
  description?: string;
  cover_url: string;
  play_url: string;
  duration: number; // in seconds
  create_time: number; // Unix timestamp
  author: VideoAuthor;
  stats: VideoStats;
  hashtags: string[];
  music: VideoMusic;
}

export interface VideoAuthor {
  id: string;
  unique_id: string; // username
  nickname: string;
  avatar_url: string;
}

export interface VideoStats {
  play_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
}

export interface VideoMusic {
  id: string;
  title: string;
  author: string;
  duration: number;
}

export interface VideoQueryResponse {
  data: {
    videos: TikTokVideo[];
    cursor: number;
    has_more: boolean;
  };
  error?: ApiError;
}

// Content Posting Types
export type PrivacyLevel = 
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

export interface PostVideoOptions {
  title: string;
  privacy_level: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  video_url?: string; // PULL_FROM_URL mode
  video_path?: string; // UPLOAD mode (local file)
  cover_image_url?: string;
  disable_duet?: boolean;
  disable_comment?: boolean;
  hashtags?: string[];
}

export interface PublishResponse {
  publish_id: string;
}

export interface PublishStatus {
  status: 'PENDING' | 'PROCESSING' | 'READY_TO_PUBLISH' | 'PUBLISH_COMPLETE' | 'FAILED';
  publish_id: string;
  error_code?: number;
  error_message?: string;
}

// Research API Types
export interface ResearchQuery {
  and?: Condition[];
  or?: Condition[];
  not?: Condition[];
}

export interface Condition {
  operation: 'EQ' | 'IN' | 'GT' | 'GTE' | 'LT' | 'LTE';
  field_name: string;
  field_values: string[];
}

export interface ResearchVideoResponse {
  data: {
    cursor: number;
    has_more: boolean;
    search_id: string;
    videos: TikTokVideo[];
  };
  error?: ApiError;
}

// Webhook Types
export interface WebhookSubscription {
  subscription_id: string;
  callback_url: string;
  event_types: string[];
  status: 'ACTIVE' | 'INACTIVE';
}

export type WebhookEventType = 
  | 'video.publish.succeed'
  | 'video.publish.failed'
  | 'video.delete.succeed';

// Error Types
export interface ApiError {
  code: number;
  message: string;
  error_description?: string;
}

// MCP Tool Response Types
export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// Scope Definitions
export const AVAILABLE_SCOPES = {
  // User Info Scopes
  USER_INFO_BASIC: 'user.info.basic',
  USER_INFO_EMAIL: 'user.info.email',
  USER_INFO_PHONE_NUMBER: 'user.info.phone_number',
  
  // Display API Scopes
  VIDEO_LIST: 'video.list',
  
  // Content Posting Scopes
  VIDEO_PUBLISH: 'video.publish',
} as const;

export type Scope = typeof AVAILABLE_SCOPES[keyof typeof AVAILABLE_SCOPES];
