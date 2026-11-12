import { afterEach, describe, expect, it, vi } from "vitest";
import { isModerator } from "./moderators";

describe("isModerator", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is false for everyone when the allowlist is unset or empty", () => {
    vi.stubEnv("MODERATOR_EMAILS", "");
    expect(isModerator({ email: "founder@example.com" })).toBe(false);
    expect(isModerator(null)).toBe(false);
  });

  it("matches listed emails regardless of case and spacing", () => {
    vi.stubEnv("MODERATOR_EMAILS", " Founder@Example.com , second@example.com");
    expect(isModerator({ email: "founder@example.com" })).toBe(true);
    expect(isModerator({ email: "SECOND@example.com" })).toBe(true);
  });

  it("rejects unlisted, missing, and empty emails", () => {
    vi.stubEnv("MODERATOR_EMAILS", "founder@example.com,");
    expect(isModerator({ email: "someone@example.com" })).toBe(false);
    expect(isModerator({ email: null })).toBe(false);
    expect(isModerator({ email: "" })).toBe(false);
    expect(isModerator({})).toBe(false);
  });
});
