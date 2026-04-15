/**
 * Phase 2: Login Kit Types
 * 
 * TikTok Login Kit enables users to log in with their TikTok account
 * and provides access to basic user profile information.
 */

/**
 * Available scopes for Login Kit
 */
export const LOGIN_KIT_SCOPES = [
  'user.info.basic',        // Display name, avatar, open_id (default)
  'user.info.email',        // Email address (requires approval)
  'user.info.phone_number', // Phone number (requires approval)
] as const;

export type LoginKitScope = typeof LOGIN_KIT_SCOPES[number];

/**
 * Basic user information available through Login Kit
 */
export interface TikTokUserInfo {
  /** Unique identifier for the user */
  open_id: string;
  
  /** User's display name (requires user.info.basic scope) */
  display_name?: string;
  
  /** Avatar URL - 50x50 pixels (requires user.info.basic scope) */
  avatar_url_50x50?: string;
  
  /** Avatar URL - 100x100 pixels (requires user.info.basic scope) */
  avatar_url_100x100?: string;
  
  /** Avatar URL - 720x720 pixels (requires user.info.basic scope) */
  avatar_url_720x720?: string;
  
  /** User's email address (requires user.info.email scope and approval) */
  email?: string;
  
  /** User's phone number (requires user.info.phone_number scope and approval) */
  phone_number?: string;
}

/**
 * Response from the user info endpoint
 */
export interface UserInfoResponse {
  code: number;
  msg: string;
  log_id: string;
  data: TikTokUserInfo;
}

/**
 * Fields that can be requested from the user info endpoint
 */
export const USER_INFO_FIELDS = [
  'open_id',
  'display_name',
  'avatar_url_50x50',
  'avatar_url_100x100',
  'avatar_url_720x720',
  'email',
] as const;

export type UserInfoField = typeof USER_INFO_FIELDS[number];
