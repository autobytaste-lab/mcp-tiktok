/**
 * Phase 4: Content Posting API Types
 * 
 * TikTok Content Posting API enables publishing videos and image carousels.
 * - Direct Post: Publish immediately to creator's account
 * - Media Upload: Send to creator inbox for review before publishing
 */

import type { PrivacyLevel } from '../core/types.js';

// ============================================================================
// Common Types
// ============================================================================

export type PostMode = 'DIRECT_POST' | 'MEDIA_UPLOAD';
export type SourceType = 'FILE_UPLOAD' | 'PULL_FROM_URL';

/** Privacy levels available for content visibility */
export const PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS', 
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY'
] as const;

// ============================================================================
// Video Posting Types
// ============================================================================

/** Post information for video content */
export interface VideoPostInfo {
  title: string;                              // Caption (max 2200 chars)
  privacy_level: PrivacyLevel;
  disable_duet?: boolean;
  disable_comment?: boolean;
  disable_stitch?: boolean;
  video_cover_timestamp_ms?: number;          // Thumbnail position in ms
  brand_content_toggle?: boolean;             // Mark as branded content
  brand_organic_toggle?: boolean;             // Mark as organic brand content
}

/** Source info for PULL_FROM_URL method */
export interface VideoSourceInfoUrl {
  source: 'PULL_FROM_URL';
  video_url: string;                          // Must be from verified domain
}

/** Source info for FILE_UPLOAD method */
export interface VideoSourceInfoFile {
  source: 'FILE_UPLOAD';
  video_size: number;                         // File size in bytes
  chunk_size: number;                         // Chunk size (10MB recommended)
  total_chunk_count: number;
}

/** Union type for video source info */
export type VideoSourceInfo = VideoSourceInfoUrl | VideoSourceInfoFile;

/** Request body for initializing a video post */
export interface VideoInitRequest {
  post_info: VideoPostInfo;
  source_info: VideoSourceInfo;
}

/** Response from video init endpoint */
export interface VideoInitResponseData {
  publish_id: string;                        // Unique ID to track the post
  upload_url?: string;                       // CDN URL for FILE_UPLOAD only
}

// ============================================================================
// Image/Photo Posting Types
// ============================================================================

/** Post information for photo carousel content */
export interface PhotoPostInfo {
  title: string;
  privacy_level: PrivacyLevel;
  description?: string;                      // Extended description
  disable_comment?: boolean;
  auto_add_music?: boolean;                  // Let TikTok add background music
}

/** Source info for photo carousel (PULL_FROM_URL only) */
export interface PhotoSourceInfoUrl {
  source: 'PULL_FROM_URL';
  photo_cover_index: number;                 // 1-based index of cover image
  photo_images: string[];                    // Array of image URLs (max 35)
}

/** Request body for initializing a photo post */
export interface PhotoInitRequest {
  post_info: PhotoPostInfo;
  source_info: PhotoSourceInfoUrl;
  post_mode: PostMode;
  media_type: 'PHOTO';
}

/** Response from photo init endpoint */
export interface PhotoInitResponseData {
  publish_id: string;
}

// ============================================================================
// Publish Status Types
// ============================================================================

/** Possible status values for a post */
export type PublishStatusValue = 
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

/** Response from publish status fetch endpoint */
export interface PublishStatusData {
  status: PublishStatusValue;
  fail_reason?: string;                      // Reason if FAILED
  publicaly_available_post_id?: string[];    // Post IDs when PUBLISH_COMPLETE
  uploaded_bytes?: number;                   // Progress for FILE_UPLOAD
}

/** Request body for fetching publish status */
export interface PublishStatusRequest {
  publish_id: string;
}

// ============================================================================
// Creator Info Types
// ============================================================================

/** Response from creator info query endpoint */
export interface CreatorInfoData {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: PrivacyLevel[];     // Available privacy levels
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;       // Max video duration allowed
}

// ============================================================================
// Inbox Video Types (for MEDIA_UPLOAD mode)
// ============================================================================

/** Request for inbox video init */
export interface InboxVideoInitRequest {
  post_info: VideoPostInfo;
  source_info: VideoSourceInfo;
}

// ============================================================================
// Constants
// ============================================================================

/** Chunk size for video FILE_UPLOAD (10 MB) */
export const CHUNK_SIZE = 10 * 1024 * 1024;

/** Maximum number of images in a carousel */
export const MAX_IMAGES_IN_CAROUSEL = 35;

/** Maximum title length */
export const MAX_TITLE_LENGTH = 2200;
