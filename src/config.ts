/**
 * Reads TikTok app credentials exclusively from environment variables.
 * These are NEVER accepted as tool parameters so the MCP client (and the
 * AI model) cannot observe or exfiltrate them.
 *
 * Set these in your MCP host config (e.g. claude_desktop_config.json) under
 * the "env" key for the server entry, or in a .env file for local development.
 */

export function getClientKey(): string {
  const v = process.env.TIKTOK_CLIENT_KEY;
  if (!v) throw new Error("TIKTOK_CLIENT_KEY environment variable is not set.");
  return v;
}

export function getClientSecret(): string {
  const v = process.env.TIKTOK_CLIENT_SECRET;
  if (!v) throw new Error("TIKTOK_CLIENT_SECRET environment variable is not set.");
  return v;
}

/**
 * Optional: lets the redirect URI be baked into the server config rather than
 * passed as a tool argument.  Falls back to the supplied override if provided.
 */
export function getRedirectUri(override?: string): string {
  const v = override ?? process.env.TIKTOK_REDIRECT_URI;
  if (!v)
    throw new Error(
      "Provide redirect_uri as a tool argument or set TIKTOK_REDIRECT_URI in the environment.",
    );
  return v;
}
