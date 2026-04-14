#!/usr/bin/env node
/**
 * TikTok MCP Server
 *
 * Security model
 * ──────────────
 * • App credentials (client_key, client_secret) are read ONLY from environment
 *   variables – never accepted as tool parameters.
 * • Access tokens are stored in ~/.config/mcp-tiktok/tokens.json (mode 0o600)
 *   after the OAuth flow and retrieved automatically by every tool.
 * • Token values are never returned to the MCP client.
 * • All API-calling tools auto-refresh the access token on 401 / expiry.
 *
 * Required env vars
 * ─────────────────
 *   TIKTOK_CLIENT_KEY      – app client key
 *   TIKTOK_CLIENT_SECRET   – app client secret
 *   TIKTOK_REDIRECT_URI    – optional default redirect URI
 *   TIKTOK_ACCESS_TOKEN    – optional override (skips token file, useful in CI)
 */

// ── Load .env for local development (silently skipped if absent) ──────────────
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
import { TikTokClient, calcVideoChunks, sleep } from "./tiktok-client.js";
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

const server = new McpServer({ name: "mcp-tiktok", version: "1.0.0" });

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
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Wraps an async operation, automatically refreshing the access token once
 * if the API returns a 401 / token-expired error.
 */
async function run<T>(
  fn: () => Promise<T>,
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  const attempt = async () => {
    try {
      return ok(await fn());
    } catch (err) {
      return null; // signals that we should inspect the error
    }
  };

  try {
    const result = ok(await fn());
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError =
      msg.includes("Access token has expired") ||
      msg.includes("HTTP 401") ||
      msg.toLowerCase().includes("token_expired") ||
      msg.toLowerCase().includes("token_invalid");

    if (isAuthError) {
      // Try silent token refresh, then retry once
      try {
        const clientKey = getClientKey();
        const clientSecret = getClientSecret();
        const refreshToken = getRefreshToken();
        const tempClient = new TikTokClient();
        const tokens = await tempClient.refreshToken({ clientKey, clientSecret, refreshToken });
        saveTokens(tokens);
      } catch {
        // Refresh itself failed – return the original error with a hint
        return fail(`${msg} (auto-refresh also failed – run tiktok_refresh_token manually)`);
      }

      try {
        return ok(await fn());
      } catch (retryErr) {
        return fail(retryErr instanceof Error ? retryErr.message : String(retryErr));
      }
    }

    return fail(msg);
  }
}

// ─── Tool 1: Get authorization URL ───────────────────────────────────────────

server.tool(
  "tiktok_get_auth_url",
  [
    "Generate a TikTok OAuth 2.0 authorization URL (PKCE).",
    "TIKTOK_CLIENT_KEY and optional TIKTOK_REDIRECT_URI are read from env vars.",
    "Steps: (1) Call this tool. (2) Open auth_url in a browser and authorize.",
    "(3) Copy the 'code' param from the redirect URL. (4) Call tiktok_exchange_code.",
  ].join(" "),
  {
    redirect_uri: z
      .string()
      .optional()
      .describe("Override TIKTOK_REDIRECT_URI. Must be registered in the TikTok developer portal."),
    scopes: z
      .array(z.string())
      .optional()
      .describe(`OAuth scopes. Defaults to: ${DEFAULT_SCOPES.join(", ")}`),
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
        code_verifier: codeVerifier,
        state,
        next_step:
          "Open auth_url in a browser. After authorizing, copy the 'code' query parameter " +
          "from the redirect URL and pass it to tiktok_exchange_code.",
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
    code: z.string().describe("Authorization code from the OAuth redirect URL"),
    redirect_uri: z
      .string()
      .optional()
      .describe("Must match the redirect_uri used in tiktok_get_auth_url"),
    code_verifier: z.string().describe("PKCE code_verifier returned by tiktok_get_auth_url"),
  },
  async ({ code, redirect_uri, code_verifier }) => {
    return run(async () => {
      const tokens = await new TikTokClient().exchangeCode({
        clientKey: getClientKey(),
        clientSecret: getClientSecret(),
        code,
        redirectUri: getRedirectUri(redirect_uri),
        codeVerifier: code_verifier,
      });
      saveTokens(tokens);
      return {
        success: true,
        open_id: tokens.open_id,
        scope: tokens.scope,
        expires_in_seconds: tokens.expires_in,
        message: "Tokens saved. You can now call other tiktok_* tools without providing credentials.",
      };
    });
  },
);

// ─── Tool 3: Refresh token ────────────────────────────────────────────────────

server.tool(
  "tiktok_refresh_token",
  "Refresh the stored access token using the stored refresh token. Updates the token file.",
  {},
  async () => {
    return run(async () => {
      const tokens = await new TikTokClient().refreshToken({
        clientKey: getClientKey(),
        clientSecret: getClientSecret(),
        refreshToken: getRefreshToken(),
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
  "Revoke the stored access token on TikTok's server and delete the local token file.",
  {},
  async () => {
    return run(async () => {
      await new TikTokClient().revokeToken({
        clientKey: getClientKey(),
        clientSecret: getClientSecret(),
        token: getAccessToken(),
      });
      clearTokens();
      return { success: true, message: "Token revoked and local token file deleted." };
    });
  },
);

// ─── Tool 5: Token status ─────────────────────────────────────────────────────

server.tool(
  "tiktok_token_status",
  "Show stored token metadata (expiry, scopes, open_id). Token values are never exposed.",
  {},
  async () => run(async () => getTokenInfo()),
);

// ─── Tool 6: Query creator info ───────────────────────────────────────────────

server.tool(
  "tiktok_get_creator_info",
  [
    "Query the authenticated creator's posting capabilities.",
    "Returns available privacy levels, max video duration, and whether duet/stitch/comments are disabled.",
    "Call this before posting to confirm what options are available for this creator.",
  ].join(" "),
  {},
  async () => run(async () => new TikTokClient(getAccessToken()).getCreatorInfo()),
);

// ─── Tool 7: Post video ───────────────────────────────────────────────────────

server.tool(
  "tiktok_post_video",
  [
    "Post a video to the authenticated creator's TikTok account.",
    "Upload options: (a) video_url – TikTok pulls from a verified-domain URL (no file transfer needed).",
    "(b) video_path – local file is uploaded in 10 MB chunks.",
    "post_mode DIRECT_POST publishes immediately; MEDIA_UPLOAD sends to creator inbox for review.",
    "Returns publish_id. Use tiktok_wait_for_post or tiktok_check_post_status to track progress.",
  ].join(" "),
  {
    title: z
      .string()
      .max(2200)
      .describe("Caption / title (max 2200 chars, hashtags and @mentions supported)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility. Run tiktok_get_creator_info to see available options."),
    video_url: z
      .string()
      .optional()
      .describe("PULL_FROM_URL: public video URL from a TikTok-verified domain"),
    video_path: z
      .string()
      .optional()
      .describe("FILE_UPLOAD: absolute path to a local MP4 video file"),
    post_mode: z
      .enum(POST_MODES)
      .optional()
      .default("DIRECT_POST")
      .describe("DIRECT_POST = publish now; MEDIA_UPLOAD = send to creator inbox"),
    disable_duet: z.boolean().optional().default(false),
    disable_comment: z.boolean().optional().default(false),
    disable_stitch: z.boolean().optional().default(false),
    video_cover_timestamp_ms: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Thumbnail position in milliseconds"),
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
    post_mode,
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
      const mode = (post_mode ?? "DIRECT_POST") as PostMode;

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
        const initFn = mode === "MEDIA_UPLOAD"
          ? client.initInboxVideoPost.bind(client)
          : client.initVideoPost.bind(client);

        const result = await initFn({
          post_info: postInfo,
          source_info: { source: "PULL_FROM_URL", video_url },
        });
        return {
          publish_id: result.publish_id,
          source: "PULL_FROM_URL",
          post_mode: mode,
          message:
            "Video post initiated. TikTok is downloading from the URL. " +
            "Call tiktok_wait_for_post or tiktok_check_post_status to track progress.",
        };
      }

      if (!fs.existsSync(video_path!)) throw new Error(`Video file not found: ${video_path}`);

      const videoSize = fs.statSync(video_path!).size;
      const { chunkSize, totalChunkCount } = calcVideoChunks(videoSize);

      const initFn = mode === "MEDIA_UPLOAD"
        ? client.initInboxVideoPost.bind(client)
        : client.initVideoPost.bind(client);

      const result = await initFn({
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
        post_mode: mode,
        video_size_bytes: videoSize,
        chunks_uploaded: totalChunkCount,
        message:
          "Video uploaded. TikTok is processing it asynchronously. " +
          "Call tiktok_wait_for_post or tiktok_check_post_status to track progress.",
      };
    });
  },
);

// ─── Tool 8: Post images ──────────────────────────────────────────────────────

server.tool(
  "tiktok_post_images",
  [
    "Post a single photo or carousel (up to 35 images) to the authenticated creator's TikTok.",
    "Image URLs must be from a TikTok-verified domain (PULL_FROM_URL only).",
    "photo_cover_index is 1-based (1 = first image).",
    "post_mode DIRECT_POST publishes now; MEDIA_UPLOAD sends to creator inbox.",
    "Returns publish_id. Use tiktok_wait_for_post or tiktok_check_post_status to track progress.",
  ].join(" "),
  {
    title: z.string().max(2200).describe("Caption / title (max 2200 chars)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility. Run tiktok_get_creator_info to see available options."),
    image_urls: z
      .array(z.string().url())
      .min(1)
      .max(35)
      .describe("Public image URLs (JPEG/PNG/WEBP) from a verified domain. Up to 35 for a carousel."),
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
      .describe("DIRECT_POST = publish now; MEDIA_UPLOAD = send to creator inbox"),
    description: z.string().optional().describe("Extended description"),
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
      const result = await new TikTokClient(getAccessToken()).initPhotoPost({
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
          "Call tiktok_wait_for_post or tiktok_check_post_status to track progress.",
      };
    });
  },
);

// ─── Tool 9: Check post status ────────────────────────────────────────────────

server.tool(
  "tiktok_check_post_status",
  [
    "Check the current publish status of a TikTok post by publish_id (single poll).",
    "Statuses: PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED.",
    "For automatic polling until done, use tiktok_wait_for_post instead.",
  ].join(" "),
  {
    publish_id: z
      .string()
      .describe("Publish ID returned by tiktok_post_video or tiktok_post_images"),
  },
  async ({ publish_id }) => {
    return run(async () => {
      const status = await new TikTokClient(getAccessToken()).getPublishStatus(publish_id);
      return {
        publish_id,
        ...status,
        ...(status.status === "PUBLISH_COMPLETE" && { note: "Content is now live on TikTok." }),
        ...(status.status === "FAILED" && {
          note: `Post failed. Reason: ${status.fail_reason ?? "unknown"}`,
        }),
      };
    });
  },
);

// ─── Tool 10: Wait for post (polling) ────────────────────────────────────────

server.tool(
  "tiktok_wait_for_post",
  [
    "Poll publish status repeatedly until PUBLISH_COMPLETE, FAILED, or timeout.",
    "Returns the final status with post IDs when the content goes live.",
    "More convenient than manually calling tiktok_check_post_status in a loop.",
  ].join(" "),
  {
    publish_id: z.string().describe("Publish ID to poll"),
    timeout_seconds: z
      .number()
      .int()
      .min(10)
      .max(600)
      .optional()
      .default(120)
      .describe("Max seconds to wait before giving up (default 120, max 600)"),
    poll_interval_seconds: z
      .number()
      .int()
      .min(3)
      .max(30)
      .optional()
      .default(5)
      .describe("Seconds between status checks (default 5)"),
  },
  async ({ publish_id, timeout_seconds, poll_interval_seconds }) => {
    return run(async () => {
      const client = new TikTokClient(getAccessToken());
      const timeoutMs = (timeout_seconds ?? 120) * 1000;
      const intervalMs = (poll_interval_seconds ?? 5) * 1000;
      const deadline = Date.now() + timeoutMs;
      let attempts = 0;

      while (Date.now() < deadline) {
        attempts++;
        const status = await client.getPublishStatus(publish_id);

        if (status.status === "PUBLISH_COMPLETE") {
          return {
            publish_id,
            status: "PUBLISH_COMPLETE",
            attempts,
            post_ids: status.publicaly_available_post_id ?? [],
            note: "Content is now live on TikTok.",
          };
        }

        if (status.status === "FAILED") {
          return {
            publish_id,
            status: "FAILED",
            attempts,
            fail_reason: status.fail_reason ?? "unknown",
          };
        }

        // Still processing – wait before next poll (unless we'd exceed deadline)
        const waitMs = Math.min(intervalMs, deadline - Date.now());
        if (waitMs > 0) await sleep(waitMs);
      }

      return {
        publish_id,
        status: "TIMEOUT",
        attempts,
        note: `Still processing after ${timeout_seconds}s. Call tiktok_check_post_status to continue monitoring.`,
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
