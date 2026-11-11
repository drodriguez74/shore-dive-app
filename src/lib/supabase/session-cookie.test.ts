import { describe, expect, it } from "vitest";
import { hasSupabaseSessionCookie } from "./session-cookie";

describe("hasSupabaseSessionCookie", () => {
  it("detects plain and chunked Supabase auth cookies", () => {
    expect(hasSupabaseSessionCookie([{ name: "sb-abc123-auth-token" }])).toBe(true);
    expect(hasSupabaseSessionCookie([{ name: "other" }, { name: "sb-abc123-auth-token.1" }])).toBe(true);
  });

  it("ignores unrelated cookies, including the PKCE verifier-less visitor", () => {
    expect(hasSupabaseSessionCookie([])).toBe(false);
    expect(hasSupabaseSessionCookie([{ name: "theme" }, { name: "sbx-auth-token" }])).toBe(false);
  });
});
