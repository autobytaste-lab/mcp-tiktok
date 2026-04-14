import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Use an isolated temp directory so tests never touch ~/.config/mcp-tiktok
const tmpDir = path.join(os.tmpdir(), `mcp-tiktok-test-${process.pid}`);

// Set env var BEFORE importing token-store so the module sees it
process.env.TIKTOK_CONFIG_DIR = tmpDir;

// Dynamic import after setting env var
const { saveTokens, getAccessToken, getRefreshToken, getTokenInfo, clearTokens } =
  await import("../token-store.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTokens(overrides: Partial<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
}> = {}) {
  return {
    access_token: "act.test_access_token",
    refresh_token: "rft.test_refresh_token",
    expires_in: 86400,
    open_id: "test_open_id",
    scope: "video.publish,user.info.basic",
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

// ── saveTokens ────────────────────────────────────────────────────────────────

describe("saveTokens", () => {
  it("creates the config directory and token file", () => {
    saveTokens(makeTokens());
    const tokenFile = path.join(tmpDir, "tokens.json");
    expect(fs.existsSync(tokenFile)).toBe(true);
  });

  it("writes valid JSON to the token file", () => {
    saveTokens(makeTokens());
    const raw = fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("stores token metadata (not validating exact field names to allow future additions)", () => {
    const input = makeTokens({ open_id: "uid_123", scope: "video.publish" });
    saveTokens(input);
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
    );
    expect(stored.open_id).toBe("uid_123");
    expect(stored.scope).toBe("video.publish");
    expect(typeof stored.expires_at).toBe("number");
  });

  it("computes expires_at as a future unix timestamp", () => {
    const before = Math.floor(Date.now() / 1000);
    saveTokens(makeTokens({ expires_in: 3600 }));
    const after = Math.floor(Date.now() / 1000);
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
    );
    expect(stored.expires_at).toBeGreaterThanOrEqual(before + 3600);
    expect(stored.expires_at).toBeLessThanOrEqual(after + 3600);
  });

  it("overwrites an existing token file", () => {
    saveTokens(makeTokens({ access_token: "act.first" }));
    saveTokens(makeTokens({ access_token: "act.second" }));
    const stored = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "tokens.json"), "utf-8"),
    );
    expect(stored.access_token).toBe("act.second");
  });
});

// ── getAccessToken ────────────────────────────────────────────────────────────

describe("getAccessToken", () => {
  it("returns the stored access token when valid", () => {
    saveTokens(makeTokens({ access_token: "act.valid_token" }));
    expect(getAccessToken()).toBe("act.valid_token");
  });

  it("throws when no token file exists", () => {
    expect(() => getAccessToken()).toThrow(/No access token found/);
  });

  it("throws when the token has expired (expires_at in the past)", () => {
    saveTokens(makeTokens({ expires_in: -3600 })); // already expired
    expect(() => getAccessToken()).toThrow(/expired/i);
  });

  it("prefers TIKTOK_ACCESS_TOKEN env var over the token file", () => {
    saveTokens(makeTokens({ access_token: "act.from_file" }));
    process.env.TIKTOK_ACCESS_TOKEN = "act.from_env";
    expect(getAccessToken()).toBe("act.from_env");
  });
});

// ── getRefreshToken ───────────────────────────────────────────────────────────

describe("getRefreshToken", () => {
  it("returns the stored refresh token", () => {
    saveTokens(makeTokens({ refresh_token: "rft.test" }));
    expect(getRefreshToken()).toBe("rft.test");
  });

  it("throws when no token file exists", () => {
    expect(() => getRefreshToken()).toThrow(/No refresh token found/);
  });
});

// ── getTokenInfo ──────────────────────────────────────────────────────────────

describe("getTokenInfo", () => {
  it("returns negative flags when no token file exists", () => {
    const info = getTokenInfo();
    expect(info.has_access_token).toBe(false);
    expect(info.has_refresh_token).toBe(false);
    expect(info.expires_at).toBeNull();
  });

  it("returns metadata without raw token values", () => {
    saveTokens(makeTokens({ open_id: "uid_abc", scope: "video.publish" }));
    const info = getTokenInfo();
    expect(info.has_access_token).toBe(true);
    expect(info.has_refresh_token).toBe(true);
    expect(info.open_id).toBe("uid_abc");
    expect(info.scope).toBe("video.publish");
    // Must not contain raw token strings
    expect(JSON.stringify(info)).not.toContain("act.test_access_token");
    expect(JSON.stringify(info)).not.toContain("rft.test_refresh_token");
  });

  it("expires_at is an ISO 8601 string", () => {
    saveTokens(makeTokens());
    const info = getTokenInfo();
    expect(info.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── clearTokens ───────────────────────────────────────────────────────────────

describe("clearTokens", () => {
  it("removes the token file", () => {
    saveTokens(makeTokens());
    clearTokens();
    expect(fs.existsSync(path.join(tmpDir, "tokens.json"))).toBe(false);
  });

  it("does not throw when called with no token file present", () => {
    expect(() => clearTokens()).not.toThrow();
  });
});
