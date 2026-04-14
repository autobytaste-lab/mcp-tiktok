import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import {
  generatePKCE,
  generateState,
  buildAuthUrl,
  DEFAULT_SCOPES,
} from "../auth.js";

describe("generatePKCE", () => {
  it("generates a code_verifier that is base64url-encoded", () => {
    const { codeVerifier } = generatePKCE();
    // base64url uses A-Z a-z 0-9 - _  (no + / =)
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates a code_challenge that is the SHA-256 of the verifier (base64url)", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const expected = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  it("generates different values on each call", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it("code_challenge is base64url-encoded (no padding)", () => {
    const { codeChallenge } = generatePKCE();
    expect(codeChallenge).not.toContain("=");
    expect(codeChallenge).not.toContain("+");
    expect(codeChallenge).not.toContain("/");
  });
});

describe("generateState", () => {
  it("returns a 32-char hex string", () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns unique values on each call", () => {
    const states = new Set(Array.from({ length: 20 }, generateState));
    expect(states.size).toBe(20);
  });
});

describe("buildAuthUrl", () => {
  const baseParams = {
    clientKey: "test_client_key",
    redirectUri: "https://example.com/callback",
    scopes: ["video.publish", "user.info.basic"],
    codeChallenge: "test_challenge_abc",
    state: "test_state_xyz",
  };

  it("targets the correct TikTok authorization endpoint", () => {
    const url = buildAuthUrl(baseParams);
    expect(url).toMatch(/^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize\//);
  });

  it("includes all required OAuth parameters", () => {
    const url = buildAuthUrl(baseParams);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_key")).toBe("test_client_key");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(parsed.searchParams.get("state")).toBe("test_state_xyz");
    expect(parsed.searchParams.get("code_challenge")).toBe("test_challenge_abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("joins multiple scopes with commas", () => {
    const url = buildAuthUrl(baseParams);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("video.publish,user.info.basic");
  });

  it("handles a single scope", () => {
    const url = buildAuthUrl({ ...baseParams, scopes: ["video.upload"] });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("video.upload");
  });
});

describe("DEFAULT_SCOPES", () => {
  it("includes required posting scopes", () => {
    expect(DEFAULT_SCOPES).toContain("video.publish");
    expect(DEFAULT_SCOPES).toContain("video.upload");
    expect(DEFAULT_SCOPES).toContain("user.info.basic");
  });
});
