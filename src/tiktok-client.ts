import axios, { isAxiosError } from "axios";
import * as fs from "fs";
import type {
  TokenResponse,
  CreatorInfo,
  VideoInitRequest,
  VideoInitResponseData,
  PhotoInitRequest,
  PhotoInitResponseData,
  PublishStatusData,
  TikTokApiResponse,
} from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = "https://open.tiktokapis.com";
const TOKEN_URL = `${API_BASE}/v2/oauth/token/`;
const REVOKE_URL = `${API_BASE}/v2/oauth/revoke/`;

/**
 * Default chunk size for video FILE_UPLOAD (10 MB).
 * TikTok requires each chunk (except the last) to be at least 5 MB.
 */
export const CHUNK_SIZE = 10 * 1024 * 1024;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const body = err.response?.data;
    if (body?.error?.message) return `${body.error.code}: ${body.error.message}`;
    if (body?.error_description) return String(body.error_description);
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function assertOk(error: TikTokApiResponse<unknown>["error"]): void {
  if (error.code !== "ok") {
    throw new Error(
      `TikTok API error [${error.code}]: ${error.message} (log_id: ${error.log_id})`,
    );
  }
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── TikTokClient ─────────────────────────────────────────────────────────────

export class TikTokClient {
  constructor(private readonly accessToken?: string) {}

  private requireToken(): string {
    if (!this.accessToken) {
      throw new Error("An access_token is required for this operation.");
    }
    return this.accessToken;
  }

  private async apiPost<T>(
    path: string,
    body: unknown,
    token: string,
  ): Promise<T> {
    const res = await axios.post<TikTokApiResponse<T>>(
      `${API_BASE}${path}`,
      body,
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          ...authHeader(token),
        },
      },
    );
    assertOk(res.data.error);
    return res.data.data;
  }

  // ── Token management ───────────────────────────────────────────────────────

  /**
   * Exchange an authorization code for access + refresh tokens.
   * POST /v2/oauth/token/ (grant_type=authorization_code)
   */
  async exchangeCode(params: {
    clientKey: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<TokenResponse> {
    try {
      const form = new URLSearchParams({
        client_key: params.clientKey,
        client_secret: params.clientSecret,
        code: params.code,
        grant_type: "authorization_code",
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      });
      const res = await axios.post<TokenResponse>(TOKEN_URL, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      return res.data;
    } catch (err) {
      throw new Error(`Token exchange failed: ${extractMessage(err)}`);
    }
  }

  /**
   * Refresh an expired access token.
   * POST /v2/oauth/token/ (grant_type=refresh_token)
   */
  async refreshToken(params: {
    clientKey: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<TokenResponse> {
    try {
      const form = new URLSearchParams({
        client_key: params.clientKey,
        client_secret: params.clientSecret,
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
      });
      const res = await axios.post<TokenResponse>(TOKEN_URL, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      return res.data;
    } catch (err) {
      throw new Error(`Token refresh failed: ${extractMessage(err)}`);
    }
  }

  /**
   * Revoke an access or refresh token.
   * POST /v2/oauth/revoke/
   */
  async revokeToken(params: {
    clientKey: string;
    clientSecret: string;
    token: string;
  }): Promise<void> {
    try {
      const form = new URLSearchParams({
        client_key: params.clientKey,
        client_secret: params.clientSecret,
        token: params.token,
      });
      await axios.post(REVOKE_URL, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (err) {
      throw new Error(`Token revocation failed: ${extractMessage(err)}`);
    }
  }

  // ── Creator info ───────────────────────────────────────────────────────────

  /**
   * Query the authenticated creator's posting capabilities.
   * Must be called before initiating a direct post.
   *
   * POST /v2/post/publish/creator_info/query/
   */
  async getCreatorInfo(): Promise<CreatorInfo> {
    const token = this.requireToken();
    try {
      return await this.apiPost<CreatorInfo>(
        "/v2/post/publish/creator_info/query/",
        {},
        token,
      );
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`Get creator info failed: ${extractMessage(err)}`);
    }
  }

  // ── Video posting ──────────────────────────────────────────────────────────

  /**
   * Initialize a video direct-post.
   * POST /v2/post/publish/video/init/
   *
   * Returns publish_id (always) and upload_url (FILE_UPLOAD only).
   * For PULL_FROM_URL, TikTok fetches the video from the provided URL.
   */
  async initVideoPost(request: VideoInitRequest): Promise<VideoInitResponseData> {
    const token = this.requireToken();
    try {
      return await this.apiPost<VideoInitResponseData>(
        "/v2/post/publish/video/init/",
        request,
        token,
      );
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`Video init failed: ${extractMessage(err)}`);
    }
  }

  /**
   * Upload a local video file to TikTok's CDN via chunked PUT.
   *
   * Each chunk uses the Content-Range header: bytes {start}-{end}/{total}.
   * All chunks except the last must be at least 5 MB (CHUNK_SIZE = 10 MB here).
   */
  async uploadVideoFile(uploadUrl: string, filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Video file not found: ${filePath}`);
    }

    const totalSize = fs.statSync(filePath).size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const fd = fs.openSync(filePath, "r");

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;
        const chunkLen = end - start + 1;

        const buf = Buffer.alloc(chunkLen);
        fs.readSync(fd, buf, 0, chunkLen, start);

        await axios.put(uploadUrl, buf, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Content-Length": String(chunkLen),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
      }
    } catch (err) {
      throw new Error(`Video chunk upload failed: ${extractMessage(err)}`);
    } finally {
      fs.closeSync(fd);
    }
  }

  // ── Photo / image posting ──────────────────────────────────────────────────

  /**
   * Initialize a photo carousel post.
   * POST /v2/post/publish/content/init/
   *
   * Photo images must be URLs from a verified domain (PULL_FROM_URL only).
   * photo_cover_index is 1-based.
   */
  async initPhotoPost(request: PhotoInitRequest): Promise<PhotoInitResponseData> {
    const token = this.requireToken();
    try {
      return await this.apiPost<PhotoInitResponseData>(
        "/v2/post/publish/content/init/",
        request,
        token,
      );
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`Photo init failed: ${extractMessage(err)}`);
    }
  }

  // ── Publish status ─────────────────────────────────────────────────────────

  /**
   * Fetch the current publish status for a given publish_id.
   * POST /v2/post/publish/status/fetch/
   *
   * Poll until status is PUBLISH_COMPLETE or FAILED.
   * Possible statuses: PROCESSING_UPLOAD, PROCESSING_DOWNLOAD,
   * SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED
   */
  async getPublishStatus(publishId: string): Promise<PublishStatusData> {
    const token = this.requireToken();
    try {
      return await this.apiPost<PublishStatusData>(
        "/v2/post/publish/status/fetch/",
        { publish_id: publishId },
        token,
      );
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(`Status fetch failed: ${extractMessage(err)}`);
    }
  }
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export function calcVideoChunks(fileSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  return {
    chunkSize: CHUNK_SIZE,
    totalChunkCount: Math.ceil(fileSize / CHUNK_SIZE),
  };
}
