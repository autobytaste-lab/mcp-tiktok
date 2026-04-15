# MCP-TikTok Full Implementation Roadmap

## Overview

This roadmap outlines the complete implementation of a comprehensive TikTok MCP server covering all major TikTok APIs and SDKs based on the official developer documentation.

---

## Table of Contents

1. [Phase 1: Core Infrastructure & OAuth](#phase-1-core-infrastructure--oauth)
2. [Phase 2: Login Kit Integration](#phase-2-login-kit-integration)
3. [Phase 3: Display API](#phase-3-display-api)
4. [Phase 4: Content Posting API (Enhanced)](#phase-4-content-posting-api-enhanced)
5. [Phase 5: Research API](#phase-5-research-api)
6. [Phase 6: Server APIs & Webhooks](#phase-6-server-apis--webhooks)
7. [Phase 7: Mobile SDKs Bridge](#phase-7-mobile-sdks-bridge)
8. [Phase 8: Advanced Features](#phase-8-advanced-features)

---

## Phase 1: Core Infrastructure & OAuth

### 1.1 Foundation Setup

**Goal:** Establish the base MCP server architecture with proper security model.

#### Tasks:
- [ ] Set up TypeScript project structure
- [ ] Configure MCP protocol handlers
- [ ] Implement secure token storage (`~/.config/mcp-tiktok/`)
- [ ] Create environment variable management
- [ ] Set up logging and error handling
- [ ] Implement rate limiting awareness

#### File Structure:
```
mcp-tiktok/
├── src/
│   ├── core/
│   │   ├── server.ts          # MCP server initialization
│   │   ├── types.ts           # Shared TypeScript types
│   │   └── errors.ts          # Custom error classes
│   ├── auth/
│   │   ├── token-manager.ts   # Token storage/retrieval
│   │   ├── oauth-client.ts    # OAuth 2.0 client
│   │   └── pkce.ts            # PKCE implementation
│   └── utils/
│       ├── logger.ts          # Logging utilities
│       └── validators.ts      # Input validation
├── package.json
└── tsconfig.json
```

### 1.2 OAuth 2.0 + PKCE Implementation

**Goal:** Complete OAuth flow for TikTok authentication.

#### Tools to Implement:

| Tool | Description |
|------|-------------|
| `tiktok_oauth_init` | Initialize OAuth flow, return auth URL |
| `tiktok_oauth_callback_handler` | Handle callback, extract code |
| `tiktok_exchange_code` | Exchange authorization code for tokens |
| `tiktok_refresh_token` | Refresh expired access token |
| `tiktok_revoke_token` | Revoke token and logout |
| `tiktok_token_status` | Check token validity and scopes |

#### OAuth Flow Diagram:
```
1. tiktok_oauth_init → Returns authorization URL
2. User opens URL, authorizes app
3. TikTok redirects to redirect_uri?code=AUTH_CODE
4. tiktok_exchange_code(code) → Stores access_token + refresh_token
5. Use access_token for API calls
6. When expired: tiktok_refresh_token() → New access_token
```

#### Code Example:
```typescript
// src/auth/oauth-client.ts
export class TikTokOAuthClient {
  private readonly AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize';
  private readonly TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
  
  async generateAuthUrl(
    clientId: string,
    redirectUri: string,
    scope: string[] = ['user.info.basic'],
    state: string
  ): Promise<string> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
    // Store code verifier for later use in token exchange
    await this.tokenManager.storeCodeVerifier(state, codeVerifier);
    
    return `${this.AUTH_BASE}?`
      + `client_key=${encodeURIComponent(clientId)}&`
      + `redirect_uri=${encodeURIComponent(redirectUri)}&`
      + `scope=${encodeURIComponent(scope.join(','))}&`
      + `state=${encodeURIComponent(state)}&`
      + `code_challenge=${encodeURIComponent(codeChallenge)}&`
      + `code_challenge_method=S256&`
      + `response_type=code`;
  }
  
  async exchangeCode(
    code: string,
    redirectUri: string
  ): Promise<OAuthTokens> {
    // Implementation for exchanging code for tokens
  }
}
```

### 1.3 Token Management

**Goal:** Secure storage and management of OAuth tokens.

#### Token Storage Structure:
```json
{
  "client_key": "encrypted_value",
  "access_token": "encrypted_value",
  "refresh_token": "encrypted_value",
  "expires_at": 1794567890,
  "scope": ["user.info.basic", "video.publish"],
  "open_id": "1234567890"
}
```

#### Implementation:
```typescript
// src/auth/token-manager.ts
export class TokenManager {
  private readonly TOKEN_DIR = '~/.config/mcp-tiktok';
  private readonly TOKEN_FILE = 'tokens.json';
  
  async storeTokens(tokens: OAuthTokens): Promise<void> {
    // Encrypt and store tokens securely
    // Directory permissions: 0700
    // File permissions: 0600
  }
  
  async getTokens(): Promise<OAuthTokens | null> {
    // Retrieve and decrypt tokens
  }
  
  async isTokenExpired(): Promise<boolean> {
    // Check if access token has expired
  }
}
```

---

## Phase 2: Login Kit Integration

### 2.1 User Authentication & Profile Access

**Goal:** Enable users to log in with TikTok and access their profile data.

#### Tools to Implement:

| Tool | Description |
|------|-------------|
| `tiktok_login_get_auth_url` | Generate Login Kit authorization URL |
| `tiktok_login_exchange_code` | Exchange code for user access token |
| `tiktok_login_get_user_info` | Get basic user profile (display name, avatar) |
| `tiktok_login_extend_token` | Extend user access token validity |

#### User Info Scopes:
- `user.info.basic` - Display name, avatar, open_id
- `user.info.email` - Email address (requires approval)
- `user.info.phone_number` - Phone number (requires approval)

#### Implementation:
```typescript
// src/login-kit/user-info.ts
export interface TikTokUserInfo {
  open_id: string;
  display_name?: string;
  avatar_url_50x50?: string;
  avatar_url_100x100?: string;
  avatar_url_720x720?: string;
  email?: string; // Requires user.info.email scope
}

export class LoginKitClient {
  private readonly USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
  
  async getUserInfo(
    accessToken: string,
    fields: string[] = ['open_id', 'display_name', 'avatar_url_50x50']
  ): Promise<TikTokUserInfo> {
    const response = await fetch(this.USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
      body: JSON.stringify({ fields })
    });
    return response.json();
  }
}
```

### 2.2 QR Code Login (Optional)

**Goal:** Support QR code-based authentication for easier user experience.

#### Tool:
| Tool | Description |
|------|-------------|
| `tiktok_login_qr_generate` | Generate QR code for login |
| `tiktok_login_qr_poll` | Poll for login completion |

---

## Phase 3: Display API

### 3.1 User Profile & Video Query

**Goal:** Enable reading TikTok user profiles and video data.

#### Tools to Implement:

| Tool | Description |
|------|-------------|
| `tiktok_display_get_user_info` | Get user profile information |
| `tiktok_display_query_videos` | Search videos by keyword/hashtag |
| `tiktok_display_list_videos` | List user's recent videos |
| `tiktok_display_get_video_detail` | Get detailed video information |

#### API Endpoints:
```typescript
// src/display-api/client.ts
export class DisplayAPIClient {
  // User Info
  private readonly GET_USER_INFO = 'https://open.tiktokapis.com/v2/user/info/';
  
  // Video Query (search)
  private readonly QUERY_VIDEOS = 'https://open.tiktokapis.com/v2/video/query/';
  
  // List Videos (user's videos)
  private readonly LIST_VIDEOS = 'https://open.tiktokapis.com/v2/video/list/';
  
  async getUserInfo(accessToken: string, openId: string): Promise<UserInfo> {
    const response = await fetch(this.GET_USER_INFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
      body: JSON.stringify({ open_id: openId })
    });
    return response.json();
  }
  
  async queryVideos(
    accessToken: string,
    keyword: string,
    maxCount: number = 10
  ): Promise<VideoQueryResponse> {
    const response = await fetch(this.QUERY_VIDEOS, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
      body: JSON.stringify({ 
        keyword,
        max_count: maxCount
      })
    });
    return response.json();
  }
}
```

### 3.2 Video Object Structure

```typescript
export interface TikTokVideo {
  id: string;
  title: string;
  cover_url: string;
  play_url: string;
  duration: number; // in seconds
  create_time: number; // Unix timestamp
  author: {
    id: string;
    unique_id: string; // username
    nickname: string;
    avatar_url: string;
  };
  stats: {
    play_count: number;
    like_count: number;
    comment_count: number;
    share_count: number;
  };
  hashtags: string[];
  music: {
    id: string;
    title: string;
    author: string;
    duration: number;
  };
}
```

---

## Phase 4: Content Posting API (Enhanced)

### 4.1 Video & Image Upload

**Goal:** Enhanced content posting with more features.

#### Existing Tools (Keep):
- `tiktok_post_video` - Post a video
- `tiktok_post_images` - Post image carousel
- `tiktok_check_post_status` - Check publish status

#### New Tools to Add:

| Tool | Description |
|------|-------------|
| `tiktok_upload_chunked` | Upload large files in chunks (10MB) |
| `tiktok_get_media_transfer_url` | Get secure upload URL |
| `tiktok_cancel_post` | Cancel a pending post |
| `tiktok_get_publish_history` | List recent publish history |

#### Enhanced Video Posting:
```typescript
// src/content-posting/video.ts
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

export class ContentPostingClient {
  async postVideo(options: PostVideoOptions): Promise<{ publish_id: string }> {
    // Implementation for posting video
  }
  
  async uploadInChunks(filePath: string, chunkSize: number = 10 * 1024 * 1024) {
    // Upload large files in 10MB chunks
  }
}
```

### 4.2 Direct Post vs Upload Modes

```typescript
// Two modes of content posting:

// Mode 1: PULL_FROM_URL (TikTok fetches from your server)
{
  "title": "My Video",
  "video_url": "https://your-verified-domain.com/video.mp4",
  "direct_post": {
    "mode": "PULL_FROM_URL"
  }
}

// Mode 2: UPLOAD (You upload to TikTok first)
{
  "title": "My Video",
  "upload_id": "uploaded_video_id_from_media_transfer_api"
}
```

---

## Phase 5: Research API

### 5.1 Data Query & Analysis

**Goal:** Enable research and analysis of TikTok content.

#### Tools to Implement:

| Tool | Description |
|------|-------------|
| `tiktok_research_query_videos` | Query videos with complex filters |
| `tiktok_research_query_user_info` | Get user info for research |
| `tiktok_research_query_comments` | Query video comments |
| `tiktok_research_query_hashtags` | Query hashtag data |
| `tiktok_research_batch_compliance` | Batch compliance check |

#### Research API Features:
- SQL-like query syntax
- Date range filtering
- Region filtering
- Keyword search
- Hashtag/music/effect filtering
- Pagination support (up to 100 results per page)

#### Implementation:
```typescript
// src/research-api/client.ts
export interface ResearchQuery {
  and?: Condition[];
  or?: Condition[];
  not?: Condition[];
}

export interface Condition {
  operation: 'EQ' | 'IN' | 'GT' | 'GTE' | 'LT' | 'LTE';
  field_name: string; // keyword, create_date, username, region_code, etc.
  field_values: string[];
}

export class ResearchAPIClient {
  private readonly VIDEO_QUERY = 'https://open.tiktokapis.com/v2/research/video/query/';
  
  async queryVideos(
    clientAccessToken: string,
    query: ResearchQuery,
    maxCount: number = 100,
    cursor: number = 0,
    startDate?: string, // Format: YYYYMMDD
    endDate?: string
  ): Promise<ResearchVideoResponse> {
    const response = await fetch(this.VIDEO_QUERY, {
      headers: { 
        Authorization: `Bearer ${clientAccessToken}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify({
        query,
        max_count: maxCount,
        cursor,
        start_date: startDate,
        end_date: endDate
      })
    });
    return response.json();
  }
}
```

#### Example Usage:
```typescript
// Find videos with keyword "hello world" from US/CA in December 2018
const results = await researchClient.queryVideos(token, {
  query: {
    and: [
      { operation: 'IN', field_name: 'region_code', field_values: ['US', 'CA'] },
      { operation: 'EQ', field_name: 'keyword', field_values: ['hello world'] }
    ]
  },
  maxCount: 100,
  startDate: '20181201',
  endDate: '20181231'
});
```

### 5.2 Available Research Fields

```typescript
export const RESEARCH_FIELDS = {
  // Video fields
  VIDEO: ['id', 'title', 'description', 'create_date', 'region_code', 
          'like_count', 'comment_count', 'share_count', 'play_count'],
  
  // Query conditions
  CONDITIONS: [
    'keyword',      // Text in title/description
    'create_date',  // Video creation date (YYYYMMDD)
    'username',     // Creator username
    'region_code',  // Country code (US, CA, etc.)
    'video_id',     // Specific video ID
    'hashtag_name', // Hashtag name
    'music_id',     // Music track ID
    'effect_id',    // Effect/filter ID
    'video_length'  // Video duration
  ]
};
```

---

## Phase 6: Server APIs & Webhooks

### 6.1 Webhook Subscription Management

**Goal:** Handle real-time events from TikTok.

#### Tools to Implement:

| Tool | Description |
|------|-------------|
| `tiktok_webhook_subscribe` | Subscribe to webhook events |
| `tiktok_webhook_unsubscribe` | Unsubscribe from events |
| `tiktok_webhook_verify` | Verify webhook signature |
| `tiktok_webhook_list_events` | List available event types |

#### Webhook Event Types:
- `video.publish.succeed`
- `video.publish.failed`
- `video.delete.succeed`
- And more...

#### Implementation:
```typescript
// src/webhooks/client.ts
export class WebhookClient {
  private readonly SUBSCRIBE_URL = 'https://open.tiktokapis.com/v2/webhook/subscribe/';
  
  async subscribe(
    accessToken: string,
    callbackUrl: string,
    eventTypes: string[]
  ): Promise<Subscription> {
    const response = await fetch(this.SUBSCRIBE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'POST',
      body: JSON.stringify({
        callback_url: callbackUrl,
        event_types: eventTypes
      })
    });
    return response.json();
  }
}
```

### 6.2 Server-Side Utilities

#### Tools:
| Tool | Description |
|------|-------------|
| `tiktok_server_get_client_token` | Get client access token (server-server) |
| `tiktok_server_revoke_client_token` | Revoke client access token |
| `tiktok_server_verify_domain` | Verify domain ownership |

---

## Phase 7: Mobile SDKs Bridge

### 7.1 iOS & Android SDK Integration Guide

**Goal:** Provide documentation and utilities for mobile SDK integration.

#### Note:
Mobile SDKs (Login Kit, Share Kit, Green Screen Kit) are primarily client-side libraries for iOS/Android apps. The MCP server can:

1. **Generate configuration snippets** for mobile apps
2. **Provide OAuth helper functions** for mobile flows
3. **Document integration steps**

#### Tools:
| Tool | Description |
|------|-------------|
| `tiktok_mobile_gen_ios_config` | Generate iOS SDK config snippet |
| `tiktok_mobile_gen_android_config` | Generate Android SDK config snippet |
| `tiktok_mobile_get_quickstart_guide` | Get platform-specific quickstart guide |

#### Example Output:
```typescript
// tiktok_mobile_gen_ios_config
{
  "platform": "iOS",
  "sdk_version": ">= 1.0.0",
  "info_plist_additions": {
    "CFBundleURLTypes": [{
      "CFBundleURLSchemes": ["your-app-scheme"]
    }]
  },
  "code_snippet": `
import TikTokLoginSDK
\nlet loginRequest = TikTokLoginRequest(
  scopes: [.UserDefault, .VideoList],
  redirectURI: "https://yourapp.com/callback"
)
loginRequest.login { response in
  // Handle login response
}
  `,
  "documentation_url": "https://developers.tiktok.com/doc/login-kit-ios-quickstart"
}
```

---

## Phase 8: Advanced Features

### 8.1 Analytics & Insights

#### Tools:
| Tool | Description |
|------|-------------|
| `tiktok_analytics_get_video_stats` | Get detailed video analytics |
| `tiktok_analytics_get_audience_insights` | Get audience demographics |
| `tiktok_analytics_compare_videos` | Compare performance across videos |

### 8.2 Batch Operations

#### Tools:
| Tool | Description |
|------|-------------|
| `tiktok_batch_query_users` | Query multiple users at once |
| `tiktok_batch_check_compliance` | Batch compliance checking |

### 8.3 Content Moderation

#### Tools:
| Tool | Description |
|------|-------------|
| `tiktok_moderation_check_content` | Check content against guidelines |
| `tiktok_moderation_get_policy` | Get moderation policies |

---

## Complete Tool Inventory

### Authentication & OAuth (6 tools)
1. `tiktok_oauth_init`
2. `tiktok_exchange_code`
3. `tiktok_refresh_token`
4. `tiktok_revoke_token`
5. `tiktok_token_status`
6. `tiktok_login_get_user_info`

### Display API (4 tools)
7. `tiktok_display_get_user_info`
8. `tiktok_display_query_videos`
9. `tiktok_display_list_videos`
10. `tiktok_display_get_video_detail`

### Content Posting (6 tools)
11. `tiktok_post_video`
12. `tiktok_post_images`
13. `tiktok_check_post_status`
14. `tiktok_upload_chunked`
15. `tiktok_cancel_post`
16. `tiktok_get_publish_history`

### Research API (5 tools)
17. `tiktok_research_query_videos`
18. `tiktok_research_query_user_info`
19. `tiktok_research_query_comments`
20. `tiktok_research_query_hashtags`
21. `tiktok_research_batch_compliance`

### Webhooks & Server (5 tools)
22. `tiktok_webhook_subscribe`
23. `tiktok_webhook_unsubscribe`
24. `tiktok_webhook_verify`
25. `tiktok_server_get_client_token`
26. `tiktok_server_verify_domain`

### Mobile SDK Helpers (3 tools)
27. `tiktok_mobile_gen_ios_config`
28. `tiktok_mobile_gen_android_config`
29. `tiktok_mobile_get_quickstart_guide`

**Total: 29 Tools**

---

## Implementation Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| Phase 1: Core & OAuth | 1-2 weeks | 🔴 Critical |
| Phase 2: Login Kit | 1 week | 🔴 Critical |
| Phase 3: Display API | 1 week | 🟡 High |
| Phase 4: Content Posting Enhanced | 1 week | 🟡 High |
| Phase 5: Research API | 2 weeks | 🟢 Medium |
| Phase 6: Webhooks | 1 week | 🟢 Medium |
| Phase 7: Mobile SDKs | 3 days | 🔵 Low |
| Phase 8: Advanced Features | 2 weeks | 🔵 Low |

**Total Estimated Time: 6-9 weeks**

---

## Security Considerations

### Token Storage:
```typescript
// Directory permissions: 0700 (owner only)
// File permissions: 0600 (owner read/write only)
const fs = require('fs');
const path = require('path');

const TOKEN_DIR = path.join(os.homedir(), '.config', 'mcp-tiktok');
fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
```

### Environment Variables:
```typescript
// Never expose these in tool responses
process.env.TIKTOK_CLIENT_KEY
process.env.TIKTOK_CLIENT_SECRET
process.env.TIKTOK_REDIRECT_URI
```

---

## Testing Strategy

1. **Unit Tests**: Each tool function
2. **Integration Tests**: OAuth flow, API calls
3. **E2E Tests**: Complete user workflows
4. **Security Tests**: Token handling, input validation

---

## Documentation

- [ ] README.md with installation instructions
- [ ] Tool reference documentation
- [ ] Example configurations for Claude Desktop, Cursor
- [ ] Troubleshooting guide
- [ ] API rate limits reference

---

*Generated based on TikTok Developer Documentation crawled from developers.tiktok.com*
