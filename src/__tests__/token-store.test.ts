import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Use an isolated temp directory so tests never touch ~/.config/mcp-tiktok
const tmpDir = path.join(os.tmpdir(), `mcp-tiktok-test-${process.pid}`);

// Set env var BEFORE importing token-manager so the module sees it
process.env.TIKTOK_CONFIG_DIR = tmpDir;

// Dynamic import after setting env var
import { TokenManager } from "../auth/token-manager.js";
import type { OAuthTokens } from "../core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTokens(overrides: Partial<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string[];
  token_type?: 'Bearer';
}> = {}): OAuthTokens {
  return {
    access_token: "act.test_access_token",
    refresh_token: "rft.test_refresh_token",
    expires_in: 86400,
    scope: ["video.publish", "user.info.basic"],
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Start each test with a clean temp directory
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  delete process.env.TIKTOK_ACCESS_TOKEN;
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  delete process.env.TIKTOK_ACCESS_TOKEN;
});

// ── TokenManager Tests ────────────────────────────────────────────────────────

describe("TokenManager", () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager(tmpDir);
  });

  describe("storeTokens", () => {
    it("creates the config directory and token file", async () => {
      await tokenManager.storeTokens(makeTokens(), "test_open_id");
      const tokenFile = path.join(tmpDir, "tokens.json");
      expect(fs.existsSync(tokenFile)).toBe(true);
    });

    it("writes valid JSON to the token file", async () => {
      await tokenManager.storeTokens(makeTokens(), "test_open_id");
      const raw = fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("stores token metadata", async () => {
      const input = makeTokens({ scope: ["video.publish"] });
      await tokenManager.storeTokens(input, "uid_123");
      const stored = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
      );
      expect(stored.open_id).toBe("uid_123");
      expect(stored.scope).toEqual(["video.publish"]);
      expect(typeof stored.expires_at).toBe("number");
    });

    it("computes expires_at as a future unix timestamp", async () => {
      const before = Math.floor(Date.now() / 1000);
      await tokenManager.storeTokens(makeTokens({ expires_in: 3600 }), "test_open_id");
      const after = Math.floor(Date.now() / 1000);
      const stored = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
      );
      expect(stored.expires_at).toBeGreaterThanOrEqual(before + 3600);
      expect(stored.expires_at).toBeLessThanOrEqual(after + 3600);
    });

    it("overwrites an existing token file", async () => {
      await tokenManager.storeTokens(makeTokens({ access_token: "act.first" }), "test_open_id");
      await tokenManager.storeTokens(makeTokens({ access_token: "act.second" }), "test_open_id");
      const stored = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
      );
      expect(stored.access_token).toBe("act.second");
    });
  });

  describe("getTokens", () => {
    it("returns the stored tokens when valid", async () => {
      await tokenManager.storeTokens(makeTokens({ access_token: "act.valid_token" }), "test_open_id");
      const tokens = await tokenManager.getTokens();
      expect(tokens?.access_token).toBe("act.valid_token");
    });

    it("returns null when no token file exists", async () => {
      const tokens = await tokenManager.getTokens();
      expect(tokens).toBeNull();
    });
  });

  describe("deleteTokens", () => {
    it("removes the token file", async () => {
      await tokenManager.storeTokens(makeTokens(), "test_open_id");
      await tokenManager.deleteTokens();
      expect(fs.existsSync(path.join(tmpDir, "tokens.json"))).toBe(false);
    });

    it("does not throw when called with no token file present", async () => {
      expect(async () => await tokenManager.deleteTokens()).not.toThrow();
    });
  });

  describe("getTokenFilePath", () => {
    it("returns the correct path to the token file", () => {
      const expectedPath = path.join(tmpDir, "tokens.json");
      expect(tokenManager.getTokenFilePath()).toBe(expectedPath);
    });
  });
});
