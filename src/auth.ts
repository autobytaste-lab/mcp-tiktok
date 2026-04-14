import * as crypto from "crypto";

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Generate a PKCE code_verifier + code_challenge pair (S256 method).
 * Store the code_verifier securely – you'll need it during token exchange.
 */
export function generatePKCE(): PKCEPair {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Generate a random state value to prevent CSRF attacks. */
export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// ─── Authorization URL builder ────────────────────────────────────────────────

export interface AuthUrlParams {
  clientKey: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  state: string;
}

/**
 * Build the TikTok OAuth 2.0 authorization URL.
 * Direct the user to this URL to start the login + consent flow.
 *
 * Docs: https://developers.tiktok.com/doc/oauth-user-access-token-management
 */
export function buildAuthUrl(params: AuthUrlParams): string {
  const { clientKey, redirectUri, scopes, codeChallenge, state } = params;
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ─── Default scopes ───────────────────────────────────────────────────────────

/** Minimum scopes required for Content Posting API. */
export const DEFAULT_SCOPES = [
  "user.info.basic",
  "video.upload",
  "video.publish",
];
