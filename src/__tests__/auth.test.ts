import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import {
  generatePKCE,
  generateState,
  DEFAULT_SCOPES,
} from "../auth/oauth-client.js";

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

describe("DEFAULT_SCOPES", () => {
  it("includes basic user info scope", () => {
    expect(DEFAULT_SCOPES).toContain("user.info.basic");
  });
});
