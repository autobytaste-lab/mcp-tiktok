/**
 * MCP Server for TikTok - Phase 2: Login Kit Integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  OAuthTokens,
  OAuthResponse,
  Scope,
  AVAILABLE_SCOPES,
} from './core/types.js';
import { oauthClient } from './auth/oauth-client.js';
import { tokenManager } from './auth/token-manager.js';
import { logger } from './utils/logger.js';
import { LoginKitClient } from './login-kit/client.js';
import type { UserInfoField } from './login-kit/types.js';
import { DisplayAPIClient } from './display-api/client.js';
import { ContentPostingClient, sleep } from './content-posting/client.js';
import { ResearchAPIClient } from './research-api/client.js';

// Create MCP server instance
const server = new McpServer({
  name: 'mcp-tiktok',
  version: '1.0.0',
});

// ============================================================================
// OAuth Tools (Phase 1)
// ============================================================================

/**
 * Initialize OAuth flow and return authorization URL
 */
server.tool(
  'tiktok_oauth_init',
  'Initialize TikTok OAuth 2.0 + PKCE flow. Returns an authorization URL that the user must open in their browser.',
  {
    scopes: z
      .array(z.enum(['user.info.basic', 'user.info.email', 'user.info.phone_number', 'video.list', 'video.publish'] as const))
      .optional()
      .describe('OAuth scopes to request. Default: ["user.info.basic"]'),
    state: z.string().optional().describe('State parameter for CSRF protection (auto-generated if not provided)'),
  },
  async ({ scopes, state }) => {
    try {
      // Use default scopes if none provided
      const requestedScopes: Scope[] = scopes?.length ? scopes : ['user.info.basic'];
      
      // Generate random state if not provided
      const finalState = state || `state_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      logger.info('Initializing OAuth flow', { scopes: requestedScopes });

      // Get client credentials from environment
      const clientId = process.env.TIKTOK_CLIENT_KEY;
      const redirectUri = process.env.TIKTOK_REDIRECT_URI;

      if (!clientId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_CLIENT_KEY',
                message: 'TIKTOK_CLIENT_KEY environment variable is not set. Please configure it before using OAuth tools.',
              },
            }, null, 2),
          }],
        };
      }

      if (!redirectUri) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_REDIRECT_URI',
                message: 'TIKTOK_REDIRECT_URI environment variable is not set. Please configure it before using OAuth tools.',
              },
            }, null, 2),
          }],
        };
      }

      // Generate authorization URL with PKCE
      const authUrl = await oauthClient.generateAuthUrl(
        clientId,
        redirectUri,
        requestedScopes,
        finalState
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              authorization_url: authUrl,
              state: finalState,
              instructions: [
                '1. Open the authorization_url in your browser',
                '2. Log in to TikTok and authorize your app',
                '3. You will be redirected to your redirect_uri with a code parameter',
                '4. Copy the code from the URL (e.g., ?code=ABC123...)',
                '5. Call tiktok_exchange_code with the code to complete authentication',
              ],
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('OAuth init failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'OAUTH_INIT_FAILED',
              message: `Failed to initialize OAuth: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Exchange authorization code for access token
 */
server.tool(
  'tiktok_exchange_code',
  'Exchange the authorization code (from OAuth callback) for access and refresh tokens. Tokens are stored securely.',
  {
    code: z.string().describe('Authorization code from TikTok redirect URL'),
    state: z.string().optional().describe('State parameter that was used in oauth_init call'),
  },
  async ({ code, state }) => {
    try {
      logger.info('Exchanging authorization code');

      // Get redirect URI from environment
      const redirectUri = process.env.TIKTOK_REDIRECT_URI;

      if (!redirectUri) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_REDIRECT_URI',
                message: 'TIKTOK_REDIRECT_URI is not configured.',
              },
            }, null, 2),
          }],
        };
      }

      // Exchange code for tokens
      const oauthResponse: OAuthResponse = await oauthClient.exchangeCode(
        code,
        redirectUri,
        state || ''
      );

      // Store tokens securely
      await tokenManager.storeTokens(oauthResponse, oauthResponse.open_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              message: 'Authentication successful! Tokens stored securely.',
              open_id: oauthResponse.open_id,
              scope: oauthResponse.scope,
              expires_in: oauthResponse.expires_in,
              token_file: tokenManager.getTokenFilePath(),
              next_steps: [
                'You can now use Display API tools (tiktok_display_*)',
                'Check token status with tiktok_token_status',
                'Token will auto-refresh when expired for supported operations',
              ],
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Code exchange failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'CODE_EXCHANGE_FAILED',
              message: `Failed to exchange code: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Refresh expired access token
 */
server.tool(
  'tiktok_refresh_token',
  'Refresh the expired access token using the stored refresh token.',
  {},
  async () => {
    try {
      // Get stored tokens
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.refresh_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'NO_REFRESH_TOKEN',
                message: 'No refresh token found. Please authenticate again using tiktok_oauth_init.',
              },
            }, null, 2),
          }],
        };
      }

      const clientId = process.env.TIKTOK_CLIENT_KEY;

      if (!clientId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_CLIENT_KEY',
                message: 'TIKTOK_CLIENT_KEY is not configured.',
              },
            }, null, 2),
          }],
        };
      }

      // Refresh token
      const newTokens: OAuthTokens = await oauthClient.refreshToken(
        storedTokens.refresh_token,
        clientId
      );

      // Update stored tokens
      await tokenManager.storeTokens(newTokens, storedTokens.open_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              message: 'Access token refreshed successfully',
              expires_in: newTokens.expires_in,
              scope: newTokens.scope,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Token refresh failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'TOKEN_REFRESH_FAILED',
              message: `Failed to refresh token: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Revoke token and logout
 */
server.tool(
  'tiktok_revoke_token',
  'Revoke the access token and delete stored tokens (logout).',
  {},
  async () => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: {
                message: 'No tokens found to revoke. You are already logged out.',
              },
            }, null, 2),
          }],
        };
      }

      // Revoke token with TikTok
      await oauthClient.revokeToken(storedTokens.access_token);

      // Delete stored tokens
      await tokenManager.deleteTokens();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              message: 'Successfully logged out. Tokens revoked and deleted.',
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Token revocation failed', { error });
      // Still delete local tokens even if revoke fails
      try {
        await tokenManager.deleteTokens();
      } catch {}
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              message: 'Local tokens deleted. (Remote revocation may have failed)',
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Check token status
 */
server.tool(
  'tiktok_token_status',
  'Check the current token status, expiry time, and scopes. Does not expose raw token values.',
  {},
  async () => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: {
                authenticated: false,
                message: 'No tokens found. Please authenticate using tiktok_oauth_init.',
              },
            }, null, 2),
          }],
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = storedTokens.expires_at || 0;
      const isExpired = now > expiresAt;
      const timeUntilExpiry = expiresAt - now;
      const hoursUntilExpiry = Math.max(0, Math.round(timeUntilExpiry / 3600));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              authenticated: true,
              open_id: storedTokens.open_id,
              scope: storedTokens.scope,
              is_expired: isExpired,
              expires_at: new Date(expiresAt).toISOString(),
              hours_until_expiry: hoursUntilExpiry,
              has_refresh_token: !!storedTokens.refresh_token,
              token_file: tokenManager.getTokenFilePath(),
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Token status check failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'TOKEN_STATUS_FAILED',
              message: `Failed to check token status: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Login Kit Tools (Phase 2)
// ============================================================================

const loginKitClient = new LoginKitClient();

/**
 * Get TikTok user profile information
 */
server.tool(
  'tiktok_login_get_user_info',
  'Get the authenticated user\'s profile information including display name, avatar URLs, and email (if authorized).',
  {
    fields: z
      .array(z.enum(['open_id', 'display_name', 'avatar_url_50x50', 'avatar_url_100x100', 'avatar_url_720x720', 'email'] as const))
      .optional()
      .describe('Fields to retrieve. Default: ["open_id", "display_name", "avatar_url_50x50"]'),
  },
  async ({ fields }) => {
    try {
      // Get stored tokens
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'NOT_AUTHENTICATED',
                message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if token is expired
      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      const isExpired = now > expiresAt;

      if (isExpired) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOKEN_EXPIRED',
                message: 'Access token has expired. Please refresh using tiktok_refresh_token.',
              },
            }, null, 2),
          }],
        };
      }

      // Determine which fields to request based on available scopes
      const requestedFields: UserInfoField[] = fields?.length 
        ? fields 
        : ['open_id', 'display_name', 'avatar_url_50x50'];

      // Filter fields based on granted scopes
      const grantedScopes = storedTokens.scope || [];
      const hasEmailScope = grantedScopes.includes('user.info.email');
      
      const filteredFields = requestedFields.filter(field => {
        if (field === 'email' && !hasEmailScope) {
          return false; // Email requires user.info.email scope
        }
        return true;
      });

      logger.info('Fetching user info', { fields: filteredFields });

      // Fetch user info from TikTok
      const userInfo = await loginKitClient.getUserInfo(
        storedTokens.access_token,
        filteredFields
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              user_info: userInfo,
              avatar_urls: {
                thumbnail_50x50: loginKitClient.getAvatarUrl(userInfo, 50),
                medium_100x100: loginKitClient.getAvatarUrl(userInfo, 100),
                high_res_720x720: loginKitClient.getAvatarUrl(userInfo, 720),
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Get user info failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'GET_USER_INFO_FAILED',
              message: `Failed to get user info: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Display API Tools (Phase 3)
// ============================================================================

const displayAPIClient = new DisplayAPIClient();

/**
 * Query videos by keyword or hashtag
 */
server.tool(
  'tiktok_display_query_videos',
  'Search for TikTok videos by keyword or hashtag. Returns video metadata including title, cover URL, play count, etc.',
  {
    keyword: z.string().min(1).max(100).describe('Search keyword or hashtag (without # symbol)'),
    max_count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe('Maximum number of results to return (1-20, default: 10)'),
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Pagination cursor for fetching more results'),
  },
  async ({ keyword, max_count, cursor }) => {
    try {
      // Get stored tokens
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'NOT_AUTHENTICATED',
                message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if token is expired
      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      const isExpired = now > expiresAt;

      if (isExpired) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOKEN_EXPIRED',
                message: 'Access token has expired. Please refresh using tiktok_refresh_token.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if user has video.list scope
      const grantedScopes = storedTokens.scope || [];
      if (!grantedScopes.includes('video.list')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_SCOPE',
                message: 'The video.list scope is required for this operation. Please re-authenticate with the video.list scope.',
              },
            }, null, 2),
          }],
        };
      }

      logger.info('Querying videos', { keyword, max_count, cursor });

      // Query videos from TikTok
      const response = await displayAPIClient.queryVideos(storedTokens.access_token, {
        keyword,
        max_count,
        cursor,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              videos: response.data.videos.map(video => ({
                id: video.id,
                title: video.title,
                description: video.description,
                cover_url: video.cover_url,
                play_url: video.play_url,
                duration: video.duration,
                create_time: new Date(video.create_time * 1000).toISOString(),
                author: {
                  id: video.author.id,
                  username: video.author.unique_id,
                  nickname: video.author.nickname,
                  avatar_url: video.author.avatar_url,
                },
                stats: {
                  plays: displayAPIClient.formatNumber(video.stats.play_count),
                  likes: displayAPIClient.formatNumber(video.stats.like_count),
                  comments: displayAPIClient.formatNumber(video.stats.comment_count),
                  shares: displayAPIClient.formatNumber(video.stats.share_count),
                },
                hashtags: video.hashtags,
                music: {
                  title: video.music.title,
                  author: video.music.author,
                  duration: video.music.duration,
                },
              })),
              pagination: {
                cursor: response.data.cursor,
                has_more: response.data.has_more,
                total_returned: response.data.videos.length,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Query videos failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'QUERY_VIDEOS_FAILED',
              message: `Failed to query videos: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * List a user's recent videos
 */
server.tool(
  'tiktok_display_list_videos',
  'List the authenticated user\'s recent videos. Requires video.list scope.',
  {
    max_count: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe('Maximum number of results to return (1-20, default: 10)'),
    cursor: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe('Pagination cursor for fetching more results'),
  },
  async ({ max_count, cursor }) => {
    try {
      // Get stored tokens
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'NOT_AUTHENTICATED',
                message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if token is expired
      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      const isExpired = now > expiresAt;

      if (isExpired) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOKEN_EXPIRED',
                message: 'Access token has expired. Please refresh using tiktok_refresh_token.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if user has video.list scope
      const grantedScopes = storedTokens.scope || [];
      if (!grantedScopes.includes('video.list')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'MISSING_SCOPE',
                message: 'The video.list scope is required for this operation. Please re-authenticate with the video.list scope.',
              },
            }, null, 2),
          }],
        };
      }

      logger.info('Listing user videos', { open_id: storedTokens.open_id });

      // List videos from TikTok
      const response = await displayAPIClient.listVideos(storedTokens.access_token, {
        open_id: storedTokens.open_id,
        max_count,
        cursor,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              videos: response.data.videos.map(video => ({
                id: video.id,
                title: video.title,
                description: video.description,
                cover_url: video.cover_url,
                play_url: video.play_url,
                duration: video.duration,
                create_time: new Date(video.create_time * 1000).toISOString(),
                author: {
                  id: video.author.id,
                  username: video.author.unique_id,
                  nickname: video.author.nickname,
                  avatar_url: video.author.avatar_url,
                },
                stats: {
                  plays: displayAPIClient.formatNumber(video.stats.play_count),
                  likes: displayAPIClient.formatNumber(video.stats.like_count),
                  comments: displayAPIClient.formatNumber(video.stats.comment_count),
                  shares: displayAPIClient.formatNumber(video.stats.share_count),
                },
                hashtags: video.hashtags,
                music: {
                  title: video.music.title,
                  author: video.music.author,
                  duration: video.music.duration,
                },
              })),
              pagination: {
                cursor: response.data.cursor,
                has_more: response.data.has_more,
                total_returned: response.data.videos.length,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('List videos failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'LIST_VIDEOS_FAILED',
              message: `Failed to list videos: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Get user profile information by open_id
 */
server.tool(
  'tiktok_display_get_user_info',
  'Get TikTok user profile information by their open_id. Requires user.info.basic scope.',
  {
    open_id: z.string().describe('The user\'s open_id to look up'),
  },
  async ({ open_id }) => {
    try {
      // Get stored tokens
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'NOT_AUTHENTICATED',
                message: 'No access token found. Please authenticate using tiktok_oauth_init and tiktok_exchange_code first.',
              },
            }, null, 2),
          }],
        };
      }

      // Check if token is expired
      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      const isExpired = now > expiresAt;

      if (isExpired) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOKEN_EXPIRED',
                message: 'Access token has expired. Please refresh using tiktok_refresh_token.',
              },
            }, null, 2),
          }],
        };
      }

      logger.info('Getting user info', { open_id });

      // Get user info from TikTok
      const userInfo = await displayAPIClient.getUserInfo(storedTokens.access_token, open_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              user_info: {
                open_id: userInfo.open_id,
                display_name: userInfo.display_name,
                avatar_urls: {
                  thumbnail_50x50: userInfo.avatar_url_50x50,
                  medium_100x100: userInfo.avatar_url_100x100,
                  high_res_720x720: userInfo.avatar_url_720x720,
                },
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Get user info failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code: 'GET_USER_INFO_FAILED',
              message: `Failed to get user info: ${error}`,
            },
          }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Content Posting API Tools (Phase 4)
// ============================================================================

const contentPostingClient = new ContentPostingClient();

/**
 * Get creator posting capabilities
 */
server.tool(
  'tiktok_posting_get_creator_info',
  'Query the authenticated creator\'s posting capabilities including available privacy levels, max video duration, and restrictions.',
  {},
  async () => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Getting creator info');
      const creatorInfo = await contentPostingClient.getCreatorInfo();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              creator_info: {
                avatar_url: creatorInfo.creator_avatar_url,
                username: creatorInfo.creator_username,
                nickname: creatorInfo.creator_nickname,
                privacy_levels_available: creatorInfo.privacy_level_options,
                max_video_duration_seconds: creatorInfo.max_video_post_duration_sec,
                restrictions: {
                  comments_disabled: creatorInfo.comment_disabled,
                  duet_disabled: creatorInfo.duet_disabled,
                  stitch_disabled: creatorInfo.stitch_disabled,
                },
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Get creator info failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'GET_CREATOR_INFO_FAILED', message: `Failed to get creator info: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Post a video (PULL_FROM_URL method)
 */
server.tool(
  'tiktok_posting_post_video',
  'Post a video to TikTok. Supports PULL_FROM_URL (TikTok downloads from verified domain) or FILE_UPLOAD (local file).',
  {
    title: z.string().max(2200).describe('Video caption/title (max 2200 chars)'),
    privacy_level: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const)
      .describe('Visibility level'),
    video_url: z.string().url().optional().describe('Video URL from verified domain (PULL_FROM_URL)'),
    video_path: z.string().optional().describe('Local file path for upload (FILE_UPLOAD)'),
    post_mode: z.enum(['DIRECT_POST', 'MEDIA_UPLOAD'] as const)
      .optional()
      .default('DIRECT_POST')
      .describe('DIRECT_POST=publish now, MEDIA_UPLOAD=send to inbox'),
    disable_duet: z.boolean().optional().default(false),
    disable_comment: z.boolean().optional().default(false),
    disable_stitch: z.boolean().optional().default(false),
  },
  async ({ title, privacy_level, video_url, video_path, post_mode, disable_duet, disable_comment, disable_stitch }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      if (!video_url && !video_path) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'INVALID_PARAMS', message: 'Provide either video_url or video_path' },
            }, null, 2),
          }],
        };
      }

      logger.info('Posting video', { mode: post_mode, source: video_url ? 'PULL_FROM_URL' : 'FILE_UPLOAD' });

      const client = new ContentPostingClient(storedTokens.access_token);
      
      if (video_url) {
        // PULL_FROM_URL method
        const result = await client.initVideoPost({
          post_info: { title, privacy_level, disable_duet, disable_comment, disable_stitch },
          source_info: { source: 'PULL_FROM_URL', video_url },
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: {
                publish_id: result.publish_id,
                source: 'PULL_FROM_URL',
                post_mode: post_mode,
                message: 'Video post initiated. Use tiktok_posting_check_status to track progress.',
              },
            }, null, 2),
          }],
        };
      }

      // FILE_UPLOAD method - not fully implemented in this version
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'NOT_IMPLEMENTED', message: 'FILE_UPLOAD requires additional setup. Use PULL_FROM_URL instead.' },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Post video failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'POST_VIDEO_FAILED', message: `Failed to post video: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Post images/photo carousel
 */
server.tool(
  'tiktok_posting_post_images',
  'Post a photo or carousel (up to 35 images) to TikTok. Images must be from verified domains.',
  {
    title: z.string().max(2200).describe('Caption/title'),
    privacy_level: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const)
      .describe('Visibility level'),
    image_urls: z.array(z.string().url()).min(1).max(35)
      .describe('Image URLs from verified domain (1-35 images)'),
    photo_cover_index: z.number().int().min(1).optional().default(1)
      .describe('Cover image index (1-based, default: 1)'),
    post_mode: z.enum(['DIRECT_POST', 'MEDIA_UPLOAD'] as const)
      .optional()
      .default('DIRECT_POST'),
    description: z.string().optional().describe('Extended description'),
    disable_comment: z.boolean().optional().default(false),
  },
  async ({ title, privacy_level, image_urls, photo_cover_index, post_mode, description, disable_comment }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Posting images', { count: image_urls.length });

      const client = new ContentPostingClient(storedTokens.access_token);
      const result = await client.initPhotoPost({
        post_info: { title, privacy_level, disable_comment, auto_add_music: true, ...(description && { description }) },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index, photo_images: image_urls },
        post_mode,
        media_type: 'PHOTO',
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              publish_id: result.publish_id,
              image_count: image_urls.length,
              cover_index: photo_cover_index,
              post_mode,
              message: 'Photo post initiated. Use tiktok_posting_check_status to track progress.',
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Post images failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'POST_IMAGES_FAILED', message: `Failed to post images: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Check publish status
 */
server.tool(
  'tiktok_posting_check_status',
  'Check the current publish status of a post by publish_id.',
  {
    publish_id: z.string().describe('Publish ID from post_video or post_images'),
  },
  async ({ publish_id }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Checking post status', { publish_id });

      const client = new ContentPostingClient(storedTokens.access_token);
      const status = await client.getPublishStatus(publish_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              publish_id,
              status: status.status,
              fail_reason: status.fail_reason,
              post_ids: status.publicaly_available_post_id,
              note: status.status === 'PUBLISH_COMPLETE' ? 'Content is now live on TikTok.' :
                   status.status === 'FAILED' ? `Post failed. Reason: ${status.fail_reason || 'unknown'}` : 'Still processing...',
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Check status failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'CHECK_STATUS_FAILED', message: `Failed to check status: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Wait for post completion (polling)
 */
server.tool(
  'tiktok_posting_wait_for_post',
  'Poll publish status repeatedly until PUBLISH_COMPLETE, FAILED, or timeout.',
  {
    publish_id: z.string().describe('Publish ID to poll'),
    timeout_seconds: z.number().int().min(10).max(600).optional().default(120)
      .describe('Max seconds to wait (default 120, max 600)'),
    poll_interval_seconds: z.number().int().min(3).max(30).optional().default(5)
      .describe('Seconds between checks (default 5)'),
  },
  async ({ publish_id, timeout_seconds, poll_interval_seconds }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      const client = new ContentPostingClient(storedTokens.access_token);
      const timeoutMs = timeout_seconds * 1000;
      const intervalMs = poll_interval_seconds * 1000;
      const deadline = Date.now() + timeoutMs;
      let attempts = 0;

      while (Date.now() < deadline) {
        attempts++;
        const status = await client.getPublishStatus(publish_id);

        if (status.status === 'PUBLISH_COMPLETE') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: {
                  publish_id,
                  status: 'PUBLISH_COMPLETE',
                  attempts,
                  post_ids: status.publicaly_available_post_id,
                  note: 'Content is now live on TikTok.',
                },
              }, null, 2),
            }],
          };
        }

        if (status.status === 'FAILED') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                data: {
                  publish_id,
                  status: 'FAILED',
                  attempts,
                  fail_reason: status.fail_reason || 'unknown',
                },
              }, null, 2),
            }],
          };
        }

        const waitMs = Math.min(intervalMs, deadline - Date.now());
        if (waitMs > 0) await sleep(waitMs);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            data: {
              publish_id,
              status: 'TIMEOUT',
              attempts,
              note: `Still processing after ${timeout_seconds}s. Call tiktok_posting_check_status to continue monitoring.`,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Wait for post failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'WAIT_FOR_POST_FAILED', message: `Failed to wait for post: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Research API Tools (Phase 5)
// ============================================================================

const researchAPIClient = new ResearchAPIClient();

/**
 * Execute SQL-like query on TikTok data
 */
server.tool(
  'tiktok_research_query',
  'Execute a SQL-like query against TikTok\'s research database. Supports SELECT, WHERE, ORDER BY, LIMIT.',
  {
    sql: z.string().describe('SQL-like query string'),
  },
  async ({ sql }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Executing research query', { sql });

      const client = new ResearchAPIClient(storedTokens.access_token);
      const result = await client.executeQuery({ sql });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              results: result.data,
              total_count: result.total_count,
              has_more: result.has_more,
              cursor: result.cursor,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Research query failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'RESEARCH_QUERY_FAILED', message: `Failed to execute query: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Query videos by hashtag
 */
server.tool(
  'tiktok_research_query_by_hashtag',
  'Query videos by hashtag within a time range.',
  {
    hashtag: z.string().describe('Hashtag to search for (without #)'),
    days_ago: z.number().int().min(1).max(90).optional().default(7)
      .describe('Look back this many days (1-90, default: 7)'),
    limit: z.number().int().min(1).max(100).optional().default(20)
      .describe('Max results to return (1-100, default: 20)'),
  },
  async ({ hashtag, days_ago, limit }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Querying by hashtag', { hashtag, days_ago });

      const client = new ResearchAPIClient(storedTokens.access_token);
      const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
      const result = await client.queryByHashtag(hashtag, timeRange, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              videos: result.data,
              total_count: result.total_count,
              has_more: result.has_more,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Query by hashtag failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'QUERY_BY_HASHTAG_FAILED', message: `Failed to query by hashtag: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Get top videos by engagement
 */
server.tool(
  'tiktok_research_top_by_engagement',
  'Get top videos by engagement (likes + shares) within a time range.',
  {
    days_ago: z.number().int().min(1).max(90).optional().default(7)
      .describe('Look back this many days'),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
  async ({ days_ago, limit }) => {
    try {
      const storedTokens = await tokenManager.getTokens();

      if (!storedTokens?.access_token) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Getting top by engagement', { days_ago });

      const client = new ResearchAPIClient(storedTokens.access_token);
      const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
      const result = await client.queryTopByEngagement(timeRange, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              videos: result.data,
              total_count: result.total_count,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Top by engagement failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'TOP_BY_ENGAGEMENT_FAILED', message: `Failed to get top videos: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

/**
 * Count videos by hashtag
 */
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
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'NOT_AUTHENTICATED', message: 'No access token found.' },
            }, null, 2),
          }],
        };
      }

      const now = Date.now();
      const expiresAt = storedTokens.expires_at || 0;
      if (now > expiresAt) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired.' },
            }, null, 2),
          }],
        };
      }

      logger.info('Counting by hashtag', { hashtag });

      const client = new ResearchAPIClient(storedTokens.access_token);
      const timeRange = ResearchAPIClient.createTimeRangeForLastDays(days_ago);
      const result = await client.countByHashtag(hashtag, timeRange);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              hashtag,
              count: result.count,
              period_days: days_ago,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('Count by hashtag failed', { error });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: { code: 'COUNT_BY_HASHTAG_FAILED', message: `Failed to count: ${error}` },
          }, null, 2),
        }],
      };
    }
  }
);

// ============================================================================
// Start Server
// ============================================================================

logger.info('MCP-TikTok server starting...');
logger.info(`Phase 1: Core Infrastructure & OAuth ✅`);
logger.info(`Phase 2: Login Kit Integration ✅`);
logger.info(`Phase 3: Display API ✅`);
logger.info(`Phase 4: Content Posting API ✅`);
logger.info(`Phase 5: Research API ✅`);
logger.info('Tools registered:');
logger.info('  OAuth: tiktok_oauth_init, tiktok_exchange_code, tiktok_refresh_token, tiktok_revoke_token, tiktok_token_status');
logger.info('  Login Kit: tiktok_login_get_user_info');
logger.info('  Display API: tiktok_display_query_videos, tiktok_display_list_videos, tiktok_display_get_user_info');
logger.info('  Content Posting: tiktok_posting_get_creator_info, tiktok_posting_post_video, tiktok_posting_post_images, tiktok_posting_check_status, tiktok_posting_wait_for_post');
logger.info('  Research API: tiktok_research_query, tiktok_research_query_by_hashtag, tiktok_research_top_by_engagement, tiktok_research_count_by_hashtag');

export default server;
