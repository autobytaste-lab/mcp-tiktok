# MCP-TikTok Full

**Full-featured MCP server for TikTok APIs** - OAuth, Display API, Content Posting, Research API, Webhooks & more.

Automate TikTok interactions from any MCP-compatible AI client (Claude Desktop, Cursor, etc.).

---

## 📚 Table of Contents

- [Features](#features)
- [Security Model](#security-model)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
  - [Phase 1: OAuth & Authentication](#phase-1-oauth--authentication)
  - [Phase 2: Login Kit](#phase-2-login-kit)
  - [Phase 3: Display API](#phase-3-display-api)
  - [Phase 4: Content Posting API](#phase-4-content-posting-api)
  - [Phase 5: Research API](#phase-5-research-api)
- [Examples](#examples)
- [Development](#development)

---

## Features

### ✅ Phase 1: Core Infrastructure & OAuth (Complete)

| Feature | Status |
|---------|--------|
| OAuth 2.0 + PKCE | ✅ Complete |
| Secure Token Storage | ✅ Complete |
| Auto Token Refresh | ✅ Complete |
| Token Management Tools | ✅ Complete |

### ✅ Phase 2: Login Kit Integration (Complete)

| Feature | Status |
|---------|--------|
| User Profile Access | ✅ Complete |
| Avatar URL Generation | ✅ Complete |
| Email/Phone Retrieval | ✅ Complete |

### ✅ Phase 3: Display API (Complete)

| Feature | Status |
|---------|--------|
| Query Videos by Keyword | ✅ Complete |
| List User's Videos | ✅ Complete |
| Get User Profile Info | ✅ Complete |

### ✅ Phase 4: Content Posting API (Complete)

| Feature | Status |
|---------|--------|
| Post Videos (PULL_FROM_URL) | ✅ Complete |
| Post Image Carousels | ✅ Complete |
| Creator Info Query | ✅ Complete |
| Publish Status Polling | ✅ Complete |

### ✅ Phase 5: Research API (Complete)

| Feature | Status |
|---------|--------|
| SQL-like Queries | ✅ Complete |
| Query by Hashtag | ✅ Complete |
| Top Videos by Engagement | ✅ Complete |
| Count by Hashtag | ✅ Complete |

---

## Security Model

| What | How it's protected |
|------|-------------------|
| `client_key` / `client_secret` | Read ONLY from environment variables – never accepted as tool parameters. |
| `access_token` / `refresh_token` | Stored in `~/.config/mcp-tiktok/tokens.json` (directory `0700`, file `0600`) after the OAuth flow. Never returned to the MCP client. |
| Token values in tool responses | Only metadata is returned (expiry time, scopes, open_id). Raw token strings are kept on disk. |

---

## Installation

```bash
# Clone repository
git clone https://github.com/autobytaste-lab/mcp-tiktok.git
cd mcp-tiktok

# Install dependencies
npm install

# Build
npm run build
```

---

## Configuration

### Environment Variables

```bash
# Required for OAuth
export TIKTOK_CLIENT_KEY="your_client_key"
export TIKTOK_REDIRECT_URI="http://localhost:3000/callback"
```

### For Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tiktok/dist/index.js"],
      "env": {
        "TIKTOK_CLIENT_KEY": "your_client_key",
        "TIKTOK_REDIRECT_URI": "http://localhost:3000/callback"
      }
    }
  }
}
```

### For Cursor

Edit `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tiktok/dist/index.js"],
      "env": {
        "TIKTOK_CLIENT_KEY": "your_client_key",
        "TIKTOK_REDIRECT_URI": "http://localhost:3000/callback"
      }
    }
  }
}
```

---

## Quick Start

### Step 1: Initialize OAuth Flow

```typescript
tiktok_oauth_init({
  scopes: ["user.info.basic", "video.list"]
})
```

Response:
```json
{
  "success": true,
  "data": {
    "authorization_url": "https://www.tiktok.com/v2/auth/authorize?client_key=...",
    "state": "state_1794567890_abc123",
    "instructions": [
      "1. Open the authorization_url in your browser",
      "2. Log in to TikTok and authorize your app",
      "3. You will be redirected to your redirect_uri with a code parameter",
      "4. Copy the code from the URL (e.g., ?code=ABC123...)",
      "5. Call tiktok_exchange_code with the code to complete authentication"
    ]
  }
}
```

### Step 2: Authorize in Browser

Open the `authorization_url` in your browser, log in to TikTok, and authorize your app.

You'll be redirected to something like:
```
http://localhost:3000/callback?code=AUTH_CODE_HERE&state=state_1794567890_abc123
```

### Step 3: Exchange Code for Tokens

```typescript
tiktok_exchange_code({
  code: "AUTH_CODE_HERE",
  state: "state_1794567890_abc123"
})
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "Authentication successful! Tokens stored securely.",
    "open_id": "1234567890",
    "scope": ["user.info.basic", "video.list"],
    "expires_in": 7199,
    "token_file": "/Users/you/.config/mcp-tiktok/tokens.json"
  }
}
```

### Step 4: Check Token Status

```typescript
tiktok_token_status()
```

Response:
```json
{
  "success": true,
  "data": {
    "authenticated": true,
    "open_id": "1234567890",
    "scope": ["user.info.basic", "video.list"],
    "is_expired": false,
    "expires_at": "2024-01-15T12:34:56.789Z",
    "hours_until_expiry": 1,
    "has_refresh_token": true
  }
}
```

---

## Available Tools

### Phase 1: OAuth & Authentication ✅

| Tool | Description |
|------|-------------|
| `tiktok_oauth_init` | Initialize OAuth flow, return auth URL |
| `tiktok_exchange_code` | Exchange authorization code for tokens |
| `tiktok_refresh_token` | Refresh expired access token |
| `tiktok_revoke_token` | Revoke token and logout |
| `tiktok_token_status` | Check token validity and scopes |

### Phase 2: Login Kit ✅

| Tool | Description |
|------|-------------|
| `tiktok_login_get_user_info` | Get authenticated user's profile info |

### Phase 3: Display API ✅

| Tool | Description |
|------|-------------|
| `tiktok_display_query_videos` | Search videos by keyword/hashtag |
| `tiktok_display_list_videos` | List authenticated user's videos |
| `tiktok_display_get_user_info` | Get user profile by open_id |

### Phase 4: Content Posting API ✅

| Tool | Description |
|------|-------------|
| `tiktok_posting_get_creator_info` | Query creator capabilities |
| `tiktok_posting_post_video` | Post a video (PULL_FROM_URL) |
| `tiktok_posting_post_images` | Post photo carousel |
| `tiktok_posting_check_status` | Check publish status |
| `tiktok_posting_wait_for_post` | Poll until complete/failed |

### Phase 5: Research API ✅

| Tool | Description |
|------|-------------|
| `tiktok_research_query` | Execute SQL-like query |
| `tiktok_research_query_by_hashtag` | Query videos by hashtag |
| `tiktok_research_top_by_engagement` | Get top videos by engagement |
| `tiktok_research_count_by_hashtag` | Count videos for hashtag |

---

## Examples

### Complete OAuth Flow

```typescript
// 1. Initialize OAuth
const initResponse = tiktok_oauth_init({ scopes: ["user.info.basic"] });
console.log("Open this URL:", initResponse.data.authorization_url);

// 2. User opens URL, authorizes, gets redirected with code
// Copy the code from redirect URL

// 3. Exchange code for tokens
const exchangeResponse = tiktok_exchange_code({ 
  code: "CODE_FROM_REDIRECT",
  state: initResponse.data.state 
});
console.log("Authenticated!", exchangeResponse.data);

// 4. Check token status
const status = tiktok_token_status();
console.log("Token valid:", !status.data.is_expired);
```

### Get User Profile Info

```typescript
const userInfo = tiktok_login_get_user_info({
  fields: ["open_id", "display_name", "avatar_url_50x50"]
});
console.log("User:", userInfo.data.user_info);
```

### Query Videos by Keyword

```typescript
const videos = tiktok_display_query_videos({
  keyword: "dance",
  max_count: 10,
  cursor: 0
});
console.log("Videos found:", videos.data.videos.length);
```

### Post a Video

```typescript
// First, check creator capabilities
const creatorInfo = tiktok_posting_get_creator_info();
console.log("Available privacy levels:", creatorInfo.data.creator_info.privacy_levels_available);

// Then post the video
const postResponse = tiktok_posting_post_video({
  title: "My amazing video! #viral",
  privacy_level: "PUBLIC_TO_EVERYONE",
  video_url: "https://verified-domain.com/video.mp4",
  disable_duet: false,
  disable_comment: false
});
console.log("Publish ID:", postResponse.data.publish_id);

// Wait for completion
const result = tiktok_posting_wait_for_post({
  publish_id: postResponse.data.publish_id,
  timeout_seconds: 120
});
console.log("Status:", result.data.status);
```

### Post Image Carousel

```typescript
const postResponse = tiktok_posting_post_images({
  title: "Photo dump! 📸",
  privacy_level: "PUBLIC_TO_EVERYONE",
  image_urls: [
    "https://verified-domain.com/img1.jpg",
    "https://verified-domain.com/img2.jpg",
    "https://verified-domain.com/img3.jpg"
  ],
  photo_cover_index: 1
});
console.log("Publish ID:", postResponse.data.publish_id);
```

### Research API - Query by Hashtag

```typescript
const result = tiktok_research_query_by_hashtag({
  hashtag: "dance",
  days_ago: 7,
  limit: 20
});
console.log("Videos:", result.data.videos);
```

### Research API - Top by Engagement

```typescript
const topVideos = tiktok_research_top_by_engagement({
  days_ago: 7,
  limit: 10
});
console.log("Top videos:", topVideos.data.videos);
```

### Auto-Refresh Token When Expired

```typescript
// Check if token is expired
const status = tiktok_token_status();
if (status.data.is_expired) {
  // Refresh automatically
  const refreshResponse = tiktok_refresh_token();
  console.log("Token refreshed!", refreshResponse.data);
}
```

---

## Development

```bash
# Run with tsx (no compile step)
npm run dev

# Compile TypeScript → dist/
npm run build

# Run compiled server
npm start

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

---

## Roadmap

See [mcp-tiktok-full-roadmap.md](./mcp-tiktok-full-roadmap.md) for the complete implementation plan.

### Current Phase: ✅ Phases 1-5 Complete!

- [x] Core Infrastructure Setup
- [x] OAuth 2.0 + PKCE Implementation
- [x] Secure Token Storage
- [x] Token Management Tools
- [x] Login Kit Integration
- [x] Display API
- [x] Content Posting API
- [x] Research API

### Next: Phase 6 - Webhooks & Mobile SDKs Bridge

---

## License

MIT

---

**Built with ❤️ for the TikTok Developer Community**
