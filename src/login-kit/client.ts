/**
 * Phase 2: Login Kit Client
 * 
 * Handles TikTok Login Kit operations:
 * - User authentication via OAuth (reuses existing OAuth flow)
 * - Fetching user profile information
 * - Token extension for longer sessions
 */

import { OAuthError } from '../core/errors.js';
import type {
  TikTokUserInfo,
  UserInfoResponse,
  UserInfoField,
} from './types.js';
import { USER_INFO_FIELDS } from './types.js';

/**
 * Login Kit Client for user authentication and profile access
 */
export class LoginKitClient {
  private readonly USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
  
  /**
   * Fetch basic user information from TikTok
   * 
   * @param accessToken - Valid access token with appropriate scopes
   * @param fields - Fields to retrieve (defaults to open_id, display_name, avatar_url_50x50)
   * @returns User profile information
   */
  async getUserInfo(
    accessToken: string,
    fields: UserInfoField[] = ['open_id', 'display_name', 'avatar_url_50x50']
  ): Promise<TikTokUserInfo> {
    // Validate fields
    const validFields = fields.filter((f): f is UserInfoField => 
      USER_INFO_FIELDS.includes(f)
    );
    
    if (validFields.length === 0) {
      throw new OAuthError(
        'At least one valid field must be specified',
        'INVALID_FIELDS'
      );
    }

    try {
      const response = await fetch(this.USER_INFO_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: validFields }),
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
        `Failed to fetch user info: ${error instanceof Error ? error.message : String(error)}`,
        'USER_INFO_FAILED'
      );
    }
  }

  /**
   * Get a formatted avatar URL with optional size override
   * 
   * @param userInfo - User info object containing avatar URLs
   * @param size - Desired size (50, 100, or 720)
   * @returns Avatar URL or undefined if not available
   */
  getAvatarUrl(userInfo: TikTokUserInfo, size: 50 | 100 | 720 = 50): string | undefined {
    const fieldMap: Record<50 | 100 | 720, keyof TikTokUserInfo> = {
      50: 'avatar_url_50x50',
      100: 'avatar_url_100x100',
      720: 'avatar_url_720x720',
    };
    
    return userInfo[fieldMap[size]];
  }

  /**
   * Check if user info has specific fields populated
   */
  hasField(userInfo: TikTokUserInfo, field: keyof TikTokUserInfo): boolean {
    return !!userInfo[field];
  }
}
