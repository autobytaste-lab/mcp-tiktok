#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import { buildAuthUrl, generatePKCE, generateState, DEFAULT_SCOPES } from "./auth.js";
import { TikTokClient, calcVideoChunks } from "./tiktok-client.js";
import type { PrivacyLevel, PostMode } from "./types.js";

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-tiktok",
  version: "1.0.0",
});

// ─── Shared enums ─────────────────────────────────────────────────────────────

const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

const POST_MODES = ["DIRECT_POST", "MEDIA_UPLOAD"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    "Generate a TikTok OAuth 2.0 authorization URL with PKCE.",
    "Steps:",
    "1. Call this tool to get auth_url + code_verifier + state.",
    "2. Open auth_url in a browser, log in, and authorize the app.",
    "3. Copy the 'code' parameter from the redirect URL.",
    "4. Call tiktok_exchange_code with code + code_verifier.",
  ].join(" "),
  {
    client_key: z
      .string()
      .describe("TikTok app client key (from https://developers.tiktok.com)"),
    redirect_uri: z
      .string()
      .describe("OAuth redirect URI registered in the developer portal"),
    scopes: z
      .array(z.string())
      .optional()
      .describe(
        `OAuth scopes to request. Defaults to ${DEFAULT_SCOPES.join(", ")}. ` +
          "Add 'video.list' to list videos.",
      ),
  },
  async ({ client_key, redirect_uri, scopes }) => {
    return run(async () => {
      const { codeVerifier, codeChallenge } = generatePKCE();
      const state = generateState();
      const authUrl = buildAuthUrl({
        clientKey: client_key,
        redirectUri: redirect_uri,
        scopes: scopes && scopes.length > 0 ? scopes : DEFAULT_SCOPES,
        codeChallenge,
        state,
      });
      return {
        auth_url: authUrl,
        code_verifier: codeVerifier,
        state,
        next_step:
          "Open auth_url in a browser. After authorizing, extract the 'code' query parameter from the redirect URL and call tiktok_exchange_code.",
      };
    });
  },
);

// ─── Tool 2: Exchange code for tokens ────────────────────────────────────────

server.tool(
  "tiktok_exchange_code",
  "Exchange a TikTok OAuth authorization code for an access token and refresh token.",
  {
    client_key: z.string().describe("TikTok app client key"),
    client_secret: z.string().describe("TikTok app client secret"),
    code: z
      .string()
      .describe("Authorization code from the OAuth redirect URL"),
    redirect_uri: z
      .string()
      .describe("Must match the redirect_uri used in tiktok_get_auth_url"),
    code_verifier: z
      .string()
      .describe("PKCE code_verifier returned by tiktok_get_auth_url"),
  },
  async ({ client_key, client_secret, code, redirect_uri, code_verifier }) => {
    return run(async () => {
      const client = new TikTokClient();
      const tokens = await client.exchangeCode({
        clientKey: client_key,
        clientSecret: client_secret,
        code,
        redirectUri: redirect_uri,
        codeVerifier: code_verifier,
      });
      return {
        ...tokens,
        note: "Store access_token and refresh_token securely. access_token expires in expires_in seconds.",
      };
    });
  },
);

// ─── Tool 3: Refresh token ────────────────────────────────────────────────────

server.tool(
  "tiktok_refresh_token",
  "Refresh an expired TikTok access token using the refresh token.",
  {
    client_key: z.string().describe("TikTok app client key"),
    client_secret: z.string().describe("TikTok app client secret"),
    refresh_token: z
      .string()
      .describe("Refresh token from a previous token exchange"),
  },
  async ({ client_key, client_secret, refresh_token }) => {
    return run(async () => {
      const client = new TikTokClient();
      return client.refreshToken({
        clientKey: client_key,
        clientSecret: client_secret,
        refreshToken: refresh_token,
      });
    });
  },
);

// ─── Tool 4: Revoke token ─────────────────────────────────────────────────────

server.tool(
  "tiktok_revoke_token",
  "Revoke a TikTok access token or refresh token.",
  {
    client_key: z.string().describe("TikTok app client key"),
    client_secret: z.string().describe("TikTok app client secret"),
    token: z.string().describe("The access token or refresh token to revoke"),
  },
  async ({ client_key, client_secret, token }) => {
    return run(async () => {
      const client = new TikTokClient();
      await client.revokeToken({
        clientKey: client_key,
        clientSecret: client_secret,
        token,
      });
      return { success: true, message: "Token revoked successfully." };
    });
  },
);

// ─── Tool 5: Query creator info ───────────────────────────────────────────────

server.tool(
  "tiktok_get_creator_info",
  [
    "Query the TikTok creator's posting capabilities (privacy levels, max video duration, etc.).",
    "Call this before posting to confirm the creator's available options.",
  ].join(" "),
  {
    access_token: z.string().describe("TikTok user access token"),
  },
  async ({ access_token }) => {
    return run(async () => {
      const client = new TikTokClient(access_token);
      return client.getCreatorInfo();
    });
  },
);

// ─── Tool 6: Post video ───────────────────────────────────────────────────────

server.tool(
  "tiktok_post_video",
  [
    "Post a video to a TikTok creator's account.",
    "Supports two upload methods:",
    "(a) PULL_FROM_URL – provide a public video_url from a verified domain; TikTok fetches it.",
    "(b) FILE_UPLOAD   – provide a local video_path; the file is uploaded in 10 MB chunks.",
    "Returns a publish_id. Use tiktok_check_post_status to track progress.",
  ].join(" "),
  {
    access_token: z
      .string()
      .describe("TikTok user access token (requires video.publish scope)"),
    title: z
      .string()
      .max(2200)
      .describe("Video caption / title (max 2200 characters, hashtags supported)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility of the post. Check tiktok_get_creator_info for available options."),
    video_url: z
      .string()
      .optional()
      .describe(
        "PULL_FROM_URL: publicly accessible URL of the video (must be from a verified domain)",
      ),
    video_path: z
      .string()
      .optional()
      .describe("FILE_UPLOAD: absolute path to a local MP4 video file"),
    disable_duet: z
      .boolean()
      .optional()
      .default(false)
      .describe("Prevent others from creating Duets with this video"),
    disable_comment: z
      .boolean()
      .optional()
      .default(false)
      .describe("Disable comments on this video"),
    disable_stitch: z
      .boolean()
      .optional()
      .default(false)
      .describe("Prevent others from Stitching this video"),
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
    access_token,
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
        throw new Error(
          "Provide either video_url (PULL_FROM_URL) or video_path (FILE_UPLOAD).",
        );
      }
      if (video_url && video_path) {
        throw new Error(
          "Provide either video_url or video_path, not both.",
        );
      }

      const client = new TikTokClient(access_token);

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
        // PULL_FROM_URL – TikTok downloads the video itself
        const result = await client.initVideoPost({
          post_info: postInfo,
          source_info: { source: "PULL_FROM_URL", video_url },
        });
        return {
          publish_id: result.publish_id,
          source: "PULL_FROM_URL",
          message:
            "Video post initiated. TikTok is pulling the video from the URL. " +
            "Poll tiktok_check_post_status with the publish_id to track progress.",
        };
      }

      // FILE_UPLOAD – chunk upload to TikTok CDN
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
          "Poll tiktok_check_post_status with the publish_id to track progress.",
      };
    });
  },
);

// ─── Tool 7: Post photos ──────────────────────────────────────────────────────

server.tool(
  "tiktok_post_images",
  [
    "Post a single photo or a photo carousel to a TikTok creator's account.",
    "Image URLs must be from a verified domain or URL prefix (PULL_FROM_URL only).",
    "Supports up to 35 images. photo_cover_index is 1-based (1 = first image).",
    "Returns a publish_id. Use tiktok_check_post_status to track progress.",
  ].join(" "),
  {
    access_token: z
      .string()
      .describe("TikTok user access token (requires video.publish scope)"),
    title: z
      .string()
      .max(2200)
      .describe("Post title / caption (max 2200 characters)"),
    privacy_level: z
      .enum(PRIVACY_LEVELS)
      .describe("Visibility of the post. Check tiktok_get_creator_info for available options."),
    image_urls: z
      .array(z.string().url())
      .min(1)
      .max(35)
      .describe(
        "Array of public image URLs (JPEG, PNG, WEBP) from a verified domain. " +
          "Up to 35 images for a carousel.",
      ),
    photo_cover_index: z
      .number()
      .int()
      .min(1)
      .optional()
      .default(1)
      .describe("1-based index of the cover image (default: 1 = first image)"),
    post_mode: z
      .enum(POST_MODES)
      .optional()
      .default("DIRECT_POST")
      .describe(
        "DIRECT_POST publishes immediately; MEDIA_UPLOAD sends to creator inbox for review",
      ),
    description: z
      .string()
      .optional()
      .describe("Optional extended description for the post"),
    disable_comment: z
      .boolean()
      .optional()
      .default(false)
      .describe("Disable comments on this post"),
    auto_add_music: z
      .boolean()
      .optional()
      .default(true)
      .describe("Let TikTok automatically add background music"),
  },
  async ({
    access_token,
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
      const client = new TikTokClient(access_token);

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
          "Poll tiktok_check_post_status with the publish_id to track progress.",
      };
    });
  },
);

// ─── Tool 8: Check post status ────────────────────────────────────────────────

server.tool(
  "tiktok_check_post_status",
  [
    "Check the publish status of a TikTok post by publish_id.",
    "Possible statuses: PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED.",
    "For DIRECT_POST, poll until PUBLISH_COMPLETE to get the final post IDs.",
  ].join(" "),
  {
    access_token: z.string().describe("TikTok user access token"),
    publish_id: z
      .string()
      .describe(
        "Publish ID returned by tiktok_post_video or tiktok_post_images",
      ),
  },
  async ({ access_token, publish_id }) => {
    return run(async () => {
      const client = new TikTokClient(access_token);
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
