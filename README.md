# mcp-tiktok

MCP server for the [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started).  
Automate posting videos and image carousels to TikTok from any MCP-compatible AI client (Claude, Cursor, etc.).

## Tools

| Tool | Description |
|------|-------------|
| `tiktok_get_auth_url` | Generate an OAuth 2.0 + PKCE authorization URL |
| `tiktok_exchange_code` | Exchange an authorization code for access + refresh tokens |
| `tiktok_refresh_token` | Refresh an expired access token |
| `tiktok_revoke_token` | Revoke an access or refresh token |
| `tiktok_get_creator_info` | Query creator capabilities (privacy levels, max duration) |
| `tiktok_post_video` | Post a video (URL pull or local file upload) |
| `tiktok_post_images` | Post a photo carousel (up to 35 images) |
| `tiktok_check_post_status` | Poll publish status by `publish_id` |

## Prerequisites

1. **TikTok Developer Account** – [Create an app](https://developers.tiktok.com) and add the **Content Posting API** product.
2. **Enable Direct Post** in your app's Content Posting API configuration.
3. Request and receive approval for the **`video.publish`** scope.
4. Register your redirect URI under **Login Kit** settings.

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

## Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tiktok/dist/index.js"]
    }
  }
}
```

## Workflow

### 1. Authenticate

```
tiktok_get_auth_url(client_key, redirect_uri)
  → open auth_url in browser → copy ?code= from redirect
tiktok_exchange_code(client_key, client_secret, code, redirect_uri, code_verifier)
  → save access_token + refresh_token
```

### 2. Post a Video (URL)

```
tiktok_get_creator_info(access_token)
tiktok_post_video(access_token, title, privacy_level, video_url="https://...")
  → publish_id
tiktok_check_post_status(access_token, publish_id)
  → PUBLISH_COMPLETE
```

### 3. Post a Video (local file)

```
tiktok_post_video(access_token, title, privacy_level, video_path="/path/to/video.mp4")
  → publish_id
tiktok_check_post_status(access_token, publish_id)
```

### 4. Post Images

```
tiktok_post_images(
  access_token, title, privacy_level,
  image_urls=["https://verified-domain.com/img1.jpg", "..."],
  photo_cover_index=1
)
  → publish_id
tiktok_check_post_status(access_token, publish_id)
```

## Notes

- **Verified domain required** – For `PULL_FROM_URL` (both video and photos), the URL must be from a [verified domain or URL prefix](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post).
- **Unaudited apps** – Content posted before your app passes audit will be restricted to private viewing.
- **Photo images** support JPEG, PNG, WEBP formats.
- **Video formats** – MP4 + H.264 recommended; see [video restrictions](https://developers.tiktok.com/doc/content-posting-api-media-upload-overview).
- **Privacy levels** available for a creator are returned by `tiktok_get_creator_info`; always check before posting.

## Development

```bash
npm run dev     # run with tsx (no build needed)
npm run build   # compile TypeScript → dist/
npm start       # run compiled server
```
