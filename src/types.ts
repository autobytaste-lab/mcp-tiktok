// ─── TikTok API Types ────────────────────────────────────────────────────────

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type PostMode = "DIRECT_POST" | "MEDIA_UPLOAD";
export type SourceType = "FILE_UPLOAD" | "PULL_FROM_URL";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

// ─── Creator Info ─────────────────────────────────────────────────────────────

export interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  /** Privacy levels available for this creator. */
  privacy_level_options: PrivacyLevel[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  /** Max allowed video duration in seconds. */
  max_video_post_duration_sec: number;
}

// ─── Video Post ───────────────────────────────────────────────────────────────

export interface VideoPostInfo {
  title: string;
  privacy_level: PrivacyLevel;
  disable_duet?: boolean;
  disable_comment?: boolean;
  disable_stitch?: boolean;
  /** Thumbnail position (milliseconds). */
  video_cover_timestamp_ms?: number;
  brand_content_toggle?: boolean;
  brand_organic_toggle?: boolean;
}

export interface VideoSourceInfoUrl {
  source: "PULL_FROM_URL";
  /** Must be from a verified domain. */
  video_url: string;
}

export interface VideoSourceInfoFile {
  source: "FILE_UPLOAD";
  video_size: number;
  chunk_size: number;
  total_chunk_count: number;
}

export type VideoSourceInfo = VideoSourceInfoUrl | VideoSourceInfoFile;

export interface VideoInitRequest {
  post_info: VideoPostInfo;
  source_info: VideoSourceInfo;
}

export interface VideoInitResponseData {
  publish_id: string;
  /** Only present for FILE_UPLOAD – the CDN endpoint to PUT chunks to. */
  upload_url?: string;
}

// ─── Photo Post ───────────────────────────────────────────────────────────────

export interface PhotoPostInfo {
  title: string;
  privacy_level: PrivacyLevel;
  description?: string;
  disable_comment?: boolean;
  auto_add_music?: boolean;
}

/**
 * For PULL_FROM_URL: photo_images is a plain string array of image URLs.
 * The URLs must be from a verified domain or URL prefix.
 * photo_cover_index is 1-based.
 */
export interface PhotoSourceInfoUrl {
  source: "PULL_FROM_URL";
  /** 1-based index of the cover photo. */
  photo_cover_index: number;
  photo_images: string[];
}

export type PhotoSourceInfo = PhotoSourceInfoUrl;

export interface PhotoInitRequest {
  post_info: PhotoPostInfo;
  source_info: PhotoSourceInfo;
  post_mode: PostMode;
  media_type: "PHOTO";
}

export interface PhotoInitResponseData {
  publish_id: string;
}

// ─── Publish Status ───────────────────────────────────────────────────────────

export type PublishStatusValue =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export interface PublishStatusData {
  status: PublishStatusValue;
  fail_reason?: string;
  /** Post IDs of the published content once status is PUBLISH_COMPLETE. */
  publicaly_available_post_id?: string[];
  uploaded_bytes?: number;
}

// ─── API Response wrapper ─────────────────────────────────────────────────────

export interface TikTokApiError {
  code: string;
  message: string;
  log_id: string;
}

export interface TikTokApiResponse<T> {
  data: T;
  error: TikTokApiError;
}
