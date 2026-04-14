import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Save originals so we can restore after each test
const origEnv = { ...process.env };

afterEach(() => {
  // Restore the original env
  for (const key of Object.keys(process.env)) {
    if (!(key in origEnv)) delete process.env[key];
  }
  Object.assign(process.env, origEnv);
});

// Import after setup so changes to process.env in each test are visible
const { getClientKey, getClientSecret, getRedirectUri } = await import("../config.js");

describe("getClientKey", () => {
  it("returns TIKTOK_CLIENT_KEY when set", () => {
    process.env.TIKTOK_CLIENT_KEY = "ck_test_value";
    expect(getClientKey()).toBe("ck_test_value");
  });

  it("throws a descriptive error when TIKTOK_CLIENT_KEY is missing", () => {
    delete process.env.TIKTOK_CLIENT_KEY;
    expect(() => getClientKey()).toThrow(/TIKTOK_CLIENT_KEY/);
  });
});

describe("getClientSecret", () => {
  it("returns TIKTOK_CLIENT_SECRET when set", () => {
    process.env.TIKTOK_CLIENT_SECRET = "cs_test_secret";
    expect(getClientSecret()).toBe("cs_test_secret");
  });

  it("throws a descriptive error when TIKTOK_CLIENT_SECRET is missing", () => {
    delete process.env.TIKTOK_CLIENT_SECRET;
    expect(() => getClientSecret()).toThrow(/TIKTOK_CLIENT_SECRET/);
  });
});

describe("getRedirectUri", () => {
  it("returns the explicit override when provided", () => {
    delete process.env.TIKTOK_REDIRECT_URI;
    expect(getRedirectUri("https://my.app/callback")).toBe("https://my.app/callback");
  });

  it("falls back to TIKTOK_REDIRECT_URI env var", () => {
    process.env.TIKTOK_REDIRECT_URI = "http://localhost:3000/callback";
    expect(getRedirectUri()).toBe("http://localhost:3000/callback");
  });

  it("explicit override takes precedence over env var", () => {
    process.env.TIKTOK_REDIRECT_URI = "http://env.example.com/cb";
    expect(getRedirectUri("https://override.example.com/cb")).toBe(
      "https://override.example.com/cb",
    );
  });

  it("throws when neither override nor env var is set", () => {
    delete process.env.TIKTOK_REDIRECT_URI;
    expect(() => getRedirectUri()).toThrow(/redirect_uri/i);
  });
});
