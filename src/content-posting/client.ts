/**
 * Phase 4: Content Posting API Client
 * 
 * TikTok Content Posting API enables publishing videos and image carousels.
 * - Direct Post: Publish immediately to creator's account
 * - Media Upload: Send to creator inbox for review before publishing
 */

import axios, { isAxiosError } from 'axios';
import * as fs from 'fs';
import type {
  VideoInitRequest,
  VideoInitResponseData,
  PhotoInitRequest,
  PhotoInitResponseData,
  PublishStatusData,
  CreatorInfoData,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://open.tiktokapis.com';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks for video upload
const REQUEST_TIMEOUT = 30_000; // 30 seconds default timeout

// ============================================================================
// Error Helpers
// ============================================================================

function extractMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const body = err.response?.data;
    const prefix = status ? `HTTP ${status}: ` : '';
    if (body?.error?.message) return `${prefix}${body.error.code} – ${body.error.message}`;
    if (body?.error_description) return `${prefix}${String(body.error_description)}`;
    return `${prefix}${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function assertOk(error: { code: string; message?: string }): void {
  if (error.code !== 'ok') {
    throw new Error(`TikTok API error [${error.code}]: ${error.message || 'Unknown error'}`);
  }
}

// ============================================================================
// ContentPostingClient
// ============================================================================

export class ContentPostingClient {
  constructor(private readonly accessToken?: string) {}

  private requireToken(): string {
    if (!this.accessToken) throw new Error('An access_token is required for this operation.');
    return this.accessToken;
  }

  private async apiPost<T>(path: string, body: unknown, token: string): Promise<T> {
    try {
      const res = await axios.post<{ data: T; error: { code: string; message?: string } }>(
        `${API_BASE}${path}`,
        body,
        {
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${token}`,
          },
          timeout: REQUEST_TIMEOUT,
        }
      );
      assertOk(res.data.error);
      return res.data.data;
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(extractMessage(err));
    }
  }

  // ========================================================================
  // Creator Info
  // ========================================================================

  /**
   * Query the authenticated creator's posting capabilities.
   * Must be called before initiating a direct post.
   */
  async getCreatorInfo(): Promise<CreatorInfoData> {
    return this.apiPost<CreatorInfoData>(
      '/v2/post/publish/creator_info/query/',
      {},
      this.requireToken()
    );
  }

  // ========================================================================
  // Video Posting - Direct Post (Publish Immediately)
  // ========================================================================

  /**
   * Initialize a video direct-post.
   * POST /v2/post/publish/video/init/
   */
  async initVideoPost(request: VideoInitRequest): Promise<VideoInitResponseData> {
    return this.apiPost<VideoInitResponseData>(
      '/v2/post/publish/video/init/',
      request,
      this.requireToken()
    );
  }

  // ========================================================================
  // Video Posting - Inbox (Send to Creator for Review)
  // ========================================================================

  /**
   * Initialize a video post to the creator's private inbox.
   * The creator reviews and publishes it manually from their TikTok inbox.
   */
  async initInboxVideoPost(request: VideoInitRequest): Promise<VideoInitResponseData> {
    return this.apiPost<VideoInitResponseData>(
      '/v2/post/publish/inbox/video/init/',
      request,
      this.requireToken()
    );
  }

  // ========================================================================
  // Photo/Carousel Posting
  // ========================================================================

  /**
   * Initialize a photo carousel post.
   * POST /v2/post/publish/content/init/
   */
  async initPhotoPost(request: PhotoInitRequest): Promise<PhotoInitResponseData> {
    return this.apiPost<PhotoInitResponseData>(
      '/v2/post/publish/content/init/',
      request,
      this.requireToken()
    );
  }

  // ========================================================================
  // Publish Status
  // ========================================================================

  /**
   * Fetch current publish status for a publish_id.
   * Poll until status is PUBLISH_COMPLETE or FAILED.
   */
  async getPublishStatus(publishId: string): Promise<PublishStatusData> {
    return this.apiPost<PublishStatusData>(
      '/v2/post/publish/status/fetch/',
      { publish_id: publishId },
      this.requireToken()
    );
  }

  // ========================================================================
  // Video Upload (FILE_UPLOAD method)
  // ========================================================================

  /**
   * Upload a local video file to TikTok's CDN via chunked PUT.
   * Each chunk uses Content-Range: bytes {start}-{end}/{total}.
   */
  async uploadVideoFile(uploadUrl: string, filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) throw new Error(`Video file not found: ${filePath}`);

    const totalSize = fs.statSync(filePath).size;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const fd = fs.openSync(filePath, 'r');

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;
        const chunkLen = end - start + 1;

        const buf = Buffer.alloc(chunkLen);
        fs.readSync(fd, buf, 0, chunkLen, start);

        try {
          await axios.put(uploadUrl, buf, {
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Content-Length': String(chunkLen),
            },
            timeout: REQUEST_TIMEOUT * 3,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          });
        } catch (err) {
          throw new Error(`Chunk ${i + 1}/${totalChunks} upload failed: ${extractMessage(err)}`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Calculate chunk size and total chunks for a video file.
   */
  static calcVideoChunks(fileSize: number): { chunkSize: number; totalChunkCount: number } {
    return { chunkSize: CHUNK_SIZE, totalChunkCount: Math.ceil(fileSize / CHUNK_SIZE) };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Sleep for a specified duration */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
