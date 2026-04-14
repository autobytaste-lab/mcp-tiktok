# mcp-tiktok

MCP server for the [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started).  
Automate posting videos and image carousels to TikTok from any MCP-compatible AI client (Claude Desktop, Cursor, etc.).

## Security model

| What | How it's protected |
|------|-------------------|
| `client_key` / `client_secret` | Read **only** from environment variables. Never accepted as tool parameters, so the AI model cannot observe them. |
| `access_token` / `refresh_token` | Stored in `~/.config/mcp-tiktok/tokens.json` (directory `0700`, file `0600`) after the OAuth flow. Never returned to the MCP client. |
| Token values in tool responses | Only metadata is returned (expiry time, scopes, open_id). Raw token strings are kept on disk. |

## Tools

| Tool | Description |
|------|-------------|
| `tiktok_get_auth_url` | Generate an OAuth 2.0 + PKCE authorization URL |
| `tiktok_exchange_code` | Exchange an authorization code → stores tokens securely |
| `tiktok_refresh_token` | Refresh the stored access token |
| `tiktok_revoke_token` | Revoke the token and delete the token file |
| `tiktok_token_status` | Show token metadata (no raw values) |
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

### For local development

```bash
cp .env.example .env
# Edit .env and fill in TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
```

### For Claude Desktop (or any MCP host)

Credentials are passed via the MCP host config, **not** the `.env` file.  
They are injected as environment variables into the server process and are
never visible to the model.

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-tiktok/dist/index.js"],
      "env": {
        "TIKTOK_CLIENT_KEY": "your_client_key",
        "TIKTOK_CLIENT_SECRET": "your_client_secret",
        "TIKTOK_REDIRECT_URI": "http://localhost:3000/callback"
      }
    }
  }
}
```

The `env` block is read by the MCP host and injected directly into the server
process — the AI model sees the tool schemas but **never** the env values.

## Workflow

### 1. Authenticate (one-time)

```
tiktok_get_auth_url
  → open auth_url in browser, authorize the app
  → copy ?code= from the redirect URL

tiktok_exchange_code(code, code_verifier)
  → tokens saved to ~/.config/mcp-tiktok/tokens.json
```

### 2. Post a Video (URL)

```
tiktok_get_creator_info
tiktok_post_video(title, privacy_level, video_url="https://verified-domain.com/video.mp4")
  → publish_id
tiktok_check_post_status(publish_id)
  → PUBLISH_COMPLETE
```

### 3. Post a Video (local file)

```
tiktok_post_video(title, privacy_level, video_path="/path/to/video.mp4")
  → publish_id
tiktok_check_post_status(publish_id)
```

### 4. Post Images

```
tiktok_post_images(
  title, privacy_level,
  image_urls=["https://verified-domain.com/img1.jpg", "https://..."],
  photo_cover_index=1
)
  → publish_id
tiktok_check_post_status(publish_id)
```

### 5. Refresh / revoke

```
tiktok_refresh_token          # get a new access token
tiktok_revoke_token           # logout and delete token file
tiktok_token_status           # check expiry / scopes (no raw values shown)
```

## Notes

- **Verified domain required** for `PULL_FROM_URL` – both video URLs and image URLs must be from a [verified domain or URL prefix](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post).
- **Unaudited apps** – content posted before your app passes TikTok's audit will be restricted to private viewing.
- **Photo formats** – JPEG, PNG, WEBP supported.
- **Video formats** – MP4 + H.264 recommended; uploaded in 10 MB chunks.
- **Privacy levels** available differ per creator — always call `tiktok_get_creator_info` first.

## Development

```bash
npm run dev     # run with tsx (no compile step)
npm run build   # compile TypeScript → dist/
npm start       # run compiled server
```
