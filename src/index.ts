#!/usr/bin/env node
/**
 * TikTok MCP Server
 *
 * Security model
 * ──────────────
 * • App credentials (client_key, client_secret) are read ONLY from environment
 *   variables – they are never accepted as tool parameters.
 * • Access tokens are stored in ~/.config/mcp-tiktok/tokens.json (mode 0o600)
 *   after the OAuth flow and retrieved automatically by every tool that needs
 *   them.  The token values themselves are never returned to the MCP client.
 *
 * Required env vars
 * ─────────────────
 *   TIKTOK_CLIENT_KEY      – your app's client key
 *   TIKTOK_CLIENT_SECRET   – your app's client secret
 *   TIKTOK_REDIRECT_URI    – optional default redirect URI
 *   TIKTOK_ACCESS_TOKEN    – optional override (skips token file, useful in CI)
 */

// Load .env for local development (silently ignored if the file is absent)
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dotenvPath = resolve(__dirname, "..", ".env");
if (existsSync(dotenvPath)) {
  for (const line of readFileSync(dotenvPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";

import { buildAuthUrl, generatePKCE, generateState, DEFAULT_SCOPES } from "./auth.js";
import { TikTokClient, calcVideoChunks } from "./tiktok-client.js";
import { getClientKey, getClientSecret, getRedirectUri } from "./config.js";
import {
  saveTokens,
  getAccessToken,
  getRefreshToken,
  getTokenInfo,
  clearTokens,
} from "./token-store.js";
import type { PrivacyLevel, PostMode } from "./types.js";

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-tiktok",
  version: "1.0.0",
});

// ─── Shared schema constants ──────────────────────────────────────────────────

const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

const POST_MODES = ["DIRECT_POST", "MEDIA_UPLOAD"] as const;

// ─── Response helpers ─────────────────────────────────────────────────────────

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

async function run<T>(
  fn: () => Promise<T>,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ─── Tool 1: Get authorization URL ───────────────────────────────────────────

server.tool(
  "tiktok_get_auth_url",
  [
    "Generate a TikTok OAuth 2.0 authorization URL (with PKCE).",
    "App credentials are read from TIKTOK_CLIENT_KEY / TIKTOK_REDIRECT_URI env vars.",
    "Steps: 1) Call this tool. 2) Open auth_url in a browser and authorize.",
    "3) Copy the 'code' from the redirect URL. 4) Call tiktok_exchange_code.",
  ].join(" "),
  {
    redirect_uri: z
      .string()
      .optional()
      .describe(
        "OAuth redirect URI (overrides TIKTOK_REDIRECT_URI env var). " +
          "Must be registered in the TikTok developer portal.",
      ),
    scopes: z
      .array(z.string())
      .optional()
      .describe(
        `OAuth scopes. Defaults to: ${DEFAULT_SCOPES.join(", ")}`,
      ),
  },
  async ({ redirect_uri, scopes }) => {
    return run(async () => {
      const clientKey = getClientKey();
      const resolvedUri = getRedirectUri(redirect_uri);
      const { codeVerifier, codeChallenge } = generatePKCE();
      const state = generateState();
      const authUrl = buildAuthUrl({
        clientKey,
        redirectUri: resolvedUri,
        scopes: scopes && scopes.length > 0 ? scopes : DEFAULT_SCOPES,
        codeChallenge,
        state,
      });
      return {
        auth_url: authUrl,
        // code_verifier is not a secret but must be stored by the caller until
        // tiktok_exchange_code is called – it is safe to return here.
        code_verifier: codeVerifier,
        state,
        next_step:
          "Open auth_url in a browser. After authorizing, copy the 'code' " +
          "query parameter from the redirect URL and call tiktok_exchange_code.",
      };
    });
  },
);

// ─── Tool 2: Exchange code for tokens ────────────────────────────────────────

server.tool(
  "tiktok_exchange_code",
  [
    "Exchange the OAuth authorization code for access + refresh tokens.",
    "Credentials are read from env vars; tokens are saved to",
    "~/.config/mcp-tiktok/tokens.json (mode 0600) and NEVER returned to the client.",
  ].join(" "),
  {
    code: z
      .string()
      .describe("Authorization code from the OAuth redirect URL"),
    redirect_uri: z
      .string()
      .optional()
      .describe("Must match the redirect_uri used in tiktok_get_auth_url"),
    code_verifier: z
      .string()
      .describe("PKCE code_verifier returned by tiktok_get_auth_url"),
  },
  async ({ code, redirect_uri, code_verifier }) => {
    return run(async () => {
      const clientKey = getClientKey();
      const clientSecret = getClientSecret();
      const resolvedUri = getRedirectUri(redirect_uri);

      const client = new TikTokClient();
      const tokens = await client.exchangeCode({
        clientKey,
        clientSecret,
        code,
        redirectUri: resolvedUri,
        codeVerifier: code_verifier,
      });

      saveTokens(tokens);

      // Return metadata only – token values stay on disk
      return {
        success: true,
        open_id: tokens.open_id,
        scope: tokens.scope,
        expires_in_seconds: tokens.expires_in,
        token_stored_at: "~/.config/mcp-tiktok/tokens.json",
        message:
          "Tokens saved securely. You can now use the other tiktok_* tools without providing credentials.",
      };
    });
  },
);

// ─── Tool 3: Refresh token ────────────────────────────────────────────────────

server.tool(
  "tiktok_refresh_token",
  [
    "Refresh the stored access token using the stored refresh token.",
    "Reads credentials from env vars and the current refresh token from the token file.",
    "Saves the new tokens back to the token file.",
  ].join(" "),
  {},
  async () => {
    return run(async () => {
      const clientKey = getClientKey();
      const clientSecret = getClientSecret();
      const refreshToken = getRefreshToken();

      const client = new TikTokClient();
      const tokens = await client.refreshToken({
        clientKey,
        clientSecret,
        refreshToken,
      });

      saveTokens(tokens);

      return {
        success: true,
        open_id: tokens.open_id,
        scope: tokens.scope,
        expires_in_seconds: tokens.expires_in,
        message: "Access token refreshed and saved.",
      };
    });
  },
);

// ─── Tool 4: Revoke token ─────────────────────────────────────────────────────

server.tool(
  "tiktok_revoke_token",
  "Revoke the stored access token and delete the local token file.",
  {},
  async () => {
    return run(async () => {
      const clientKey = getClientKey();
      const clientSecret = getClientSecret();
      const accessToken = getAccessToken();

      const client = new TikTokClient();
      await client.revokeToken({ clientKey, clientSecret, token: accessToken });
      clearTokens();

      return {
        success: true,
        message: "Token revoked and local token file deleted.",
      };
    });
  },
);

// ─── Tool 5: Token status ─────────────────────────────────────────────────────

server.tool(
  "tiktok_token_status",
  "Check whether valid tokens are stored locally (shows metadata, not token values).",
  {},
  async () => {
    return run(async () => getTokenInfo());
  },
);

// ─── Tool 6: Query creator info ───────────────────────────────────────────────

server.tool(
  "tiktok_get_creator_info",
  [
    "Query the authenticated creator's posting capabilities",
    "(available privacy levels, max video duration, etc.).",
    "Call this before posting to confirm the creator's options.",
  ].join(" "),
  {},
  async () => {
    return run(async () => {
      const client = new TikTokClient(getAccessToken());
      return client.getCreatorInfo();
    });
  },
);

// ─── Tool 7: Post video ───────────────────────────────────────────────────────

server.tool(
  "tiktok_post_video",
  [
    "Post a video to the authenticated creator's TikTok account.",
    "Upload methods:",
    "(a) PULL_FROM_URL – provide video_url pointing to a verified domain; TikTok fetches it.",
    "(b) FILE_UPLOAD   – provide video_path (local file); uploaded in 10 MB chunks.",
    "Returns a publish_id. Use tiktok_check_post_status to monitor progress.",
  ].join(" "),
  {
    title: z
      .string()
      .max(2200)
      .describe("Video caption / title (max 2200 chars, hashtags and @mentions supported)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility. Run tiktok_get_creator_info to see available options for this creator."),
    video_url: z
      .string()
      .optional()
      .describe("PULL_FROM_URL: public video URL from a verified domain"),
    video_path: z
      .string()
      .optional()
      .describe("FILE_UPLOAD: absolute path to a local MP4 video file"),
    disable_duet: z.boolean().optional().default(false),
    disable_comment: z.boolean().optional().default(false),
    disable_stitch: z.boolean().optional().default(false),
    video_cover_timestamp_ms: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Thumbnail frame position in milliseconds"),
    brand_content_toggle: z
      .boolean()
      .optional()
      .default(false)
      .describe("Mark as branded content (paid partnership)"),
    brand_organic_toggle: z
      .boolean()
      .optional()
      .default(false)
      .describe("Mark as organic brand content"),
  },
  async ({
    title,
    privacy_level,
    video_url,
    video_path,
    disable_duet,
    disable_comment,
    disable_stitch,
    video_cover_timestamp_ms,
    brand_content_toggle,
    brand_organic_toggle,
  }) => {
    return run(async () => {
      if (!video_url && !video_path) {
        throw new Error("Provide either video_url (PULL_FROM_URL) or video_path (FILE_UPLOAD).");
      }
      if (video_url && video_path) {
        throw new Error("Provide either video_url or video_path, not both.");
      }

      const client = new TikTokClient(getAccessToken());

      const postInfo = {
        title,
        privacy_level: privacy_level as PrivacyLevel,
        disable_duet: disable_duet ?? false,
        disable_comment: disable_comment ?? false,
        disable_stitch: disable_stitch ?? false,
        ...(video_cover_timestamp_ms !== undefined && { video_cover_timestamp_ms }),
        ...(brand_content_toggle && { brand_content_toggle }),
        ...(brand_organic_toggle && { brand_organic_toggle }),
      };

      if (video_url) {
        const result = await client.initVideoPost({
          post_info: postInfo,
          source_info: { source: "PULL_FROM_URL", video_url },
        });
        return {
          publish_id: result.publish_id,
          source: "PULL_FROM_URL",
          message:
            "Video post initiated. TikTok is downloading the video from the URL. " +
            "Call tiktok_check_post_status to monitor progress.",
        };
      }

      if (!fs.existsSync(video_path!)) {
        throw new Error(`Video file not found: ${video_path}`);
      }

      const videoSize = fs.statSync(video_path!).size;
      const { chunkSize, totalChunkCount } = calcVideoChunks(videoSize);

      const result = await client.initVideoPost({
        post_info: postInfo,
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      });

      await client.uploadVideoFile(result.upload_url!, video_path!);

      return {
        publish_id: result.publish_id,
        source: "FILE_UPLOAD",
        video_size_bytes: videoSize,
        chunks_uploaded: totalChunkCount,
        message:
          "Video uploaded. TikTok is processing it asynchronously. " +
          "Call tiktok_check_post_status to monitor progress.",
      };
    });
  },
);

// ─── Tool 8: Post images ──────────────────────────────────────────────────────

server.tool(
  "tiktok_post_images",
  [
    "Post a photo or carousel (up to 35 images) to the authenticated creator's TikTok.",
    "Image URLs must be from a verified domain (PULL_FROM_URL).",
    "photo_cover_index is 1-based (1 = first image).",
    "Returns a publish_id. Use tiktok_check_post_status to monitor progress.",
  ].join(" "),
  {
    title: z.string().max(2200).describe("Post caption / title (max 2200 chars)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility. Run tiktok_get_creator_info to see available options."),
    image_urls: z
      .array(z.string().url())
      .min(1)
      .max(35)
      .describe(
        "Public image URLs (JPEG / PNG / WEBP) from a verified domain. Up to 35 for a carousel.",
      ),
    photo_cover_index: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(1)
      .describe("1-based index of the cover image (default: 1)"),
    post_mode: z
      .enum(POST_MODES)
      .optional()
      .default("DIRECT_POST")
      .describe("DIRECT_POST publishes immediately; MEDIA_UPLOAD sends to creator inbox"),
    description: z.string().optional().describe("Extended description for the post"),
    disable_comment: z.boolean().optional().default(false),
    auto_add_music: z
      .boolean()
      .optional()
      .default(true)
      .describe("Let TikTok automatically add background music"),
  },
  async ({
    title,
    privacy_level,
    image_urls,
    photo_cover_index,
    post_mode,
    description,
    disable_comment,
    auto_add_music,
  }) => {
    return run(async () => {
      const client = new TikTokClient(getAccessToken());

      const result = await client.initPhotoPost({
        post_info: {
          title,
          privacy_level: privacy_level as PrivacyLevel,
          disable_comment: disable_comment ?? false,
          auto_add_music: auto_add_music ?? true,
          ...(description && { description }),
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_cover_index: photo_cover_index ?? 1,
          photo_images: image_urls,
        },
        post_mode: (post_mode ?? "DIRECT_POST") as PostMode,
        media_type: "PHOTO",
      });

      return {
        publish_id: result.publish_id,
        image_count: image_urls.length,
        cover_index: photo_cover_index ?? 1,
        post_mode: post_mode ?? "DIRECT_POST",
        message:
          "Photo post initiated. " +
          "Call tiktok_check_post_status to monitor progress.",
      };
    });
  },
);

// ─── Tool 9: Check post status ────────────────────────────────────────────────

server.tool(
  "tiktok_check_post_status",
  [
    "Check the publish status of a TikTok post by publish_id.",
    "Statuses: PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED.",
  ].join(" "),
  {
    publish_id: z
      .string()
      .describe("Publish ID returned by tiktok_post_video or tiktok_post_images"),
  },
  async ({ publish_id }) => {
    return run(async () => {
      const client = new TikTokClient(getAccessToken());
      const status = await client.getPublishStatus(publish_id);
      return {
        publish_id,
        ...status,
        ...(status.status === "PUBLISH_COMPLETE" && {
          note: "Content is now live on TikTok.",
        }),
        ...(status.status === "FAILED" && {
          note: `Post failed. Reason: ${status.fail_reason ?? "unknown"}`,
        }),
      };
    });
  },
);

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("TikTok MCP server started (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
