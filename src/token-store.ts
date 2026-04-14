/**
 * Persists OAuth tokens to a restricted local file so they are never passed
 * through the MCP tool interface (and thus never visible to the AI model).
 *
 * Storage path : ~/.config/mcp-tiktok/tokens.json
 * Directory    : mode 0o700 (owner access only)
 * File         : mode 0o600 (owner read/write only)
 *
 * Priority for access_token resolution:
 *   1. TIKTOK_ACCESS_TOKEN env var  (useful for CI / scripted setups)
 *   2. tokens.json on disk          (written after tiktok_exchange_code)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "mcp-tiktok");
const TOKEN_FILE = path.join(CONFIG_DIR, "tokens.json");

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** Unix timestamp (seconds) when access_token expires. */
  expires_at: number;
  open_id: string;
  scope: string;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function saveTokens(tokens: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
}): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const data: StoredTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
    open_id: tokens.open_id,
    scope: tokens.scope,
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
    flag: "w",
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

function loadTokens(): StoredTokens | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as StoredTokens;
  } catch {
    return null;
  }
}

/**
 * Return a valid access token or throw with a helpful message.
 * Never returns an expired token (warns 60 s before expiry).
 */
export function getAccessToken(): string {
  // Env-var override (CI / manual testing)
  if (process.env.TIKTOK_ACCESS_TOKEN) {
    return process.env.TIKTOK_ACCESS_TOKEN;
  }

  const stored = loadTokens();
  if (!stored) {
    throw new Error(
      "No access token found. " +
        "Call tiktok_get_auth_url → authorize in browser → tiktok_exchange_code first.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (stored.expires_at - now < 60) {
    throw new Error(
      "Access token has expired. Call tiktok_refresh_token to get a new one.",
    );
  }

  return stored.access_token;
}

export function getRefreshToken(): string {
  const stored = loadTokens();
  if (!stored?.refresh_token) {
    throw new Error(
      "No refresh token found. " +
        "Call tiktok_get_auth_url → authorize in browser → tiktok_exchange_code first.",
    );
  }
  return stored.refresh_token;
}

/** Returns stored metadata without exposing the actual token values. */
export function getTokenInfo(): {
  has_access_token: boolean;
  has_refresh_token: boolean;
  expires_at: string | null;
  open_id: string | null;
  scope: string | null;
} {
  const stored = loadTokens();
  if (!stored) {
    return {
      has_access_token: false,
      has_refresh_token: false,
      expires_at: null,
      open_id: null,
      scope: null,
    };
  }
  return {
    has_access_token: !!stored.access_token,
    has_refresh_token: !!stored.refresh_token,
    expires_at: new Date(stored.expires_at * 1000).toISOString(),
    open_id: stored.open_id,
    scope: stored.scope,
  };
}

export function clearTokens(): void {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}
