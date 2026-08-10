import { describe, expect, it } from "vitest";
import { EMBED_DOMAIN_ALLOWLIST, isAllowlistedEmbedUrl } from "./allowlist";

describe("isAllowlistedEmbedUrl", () => {
  it("allows an exact-match hostname from the allowlist", () => {
    const [firstHost] = EMBED_DOMAIN_ALLOWLIST;
    expect(isAllowlistedEmbedUrl(`https://${firstHost}/player/site-1`)).toBe(true);
  });

  it("matches case-insensitively", () => {
    const [firstHost] = EMBED_DOMAIN_ALLOWLIST;
    expect(isAllowlistedEmbedUrl(`https://${firstHost.toUpperCase()}/player/site-1`)).toBe(true);
  });

  it("rejects a hostname not on the allowlist", () => {
    expect(isAllowlistedEmbedUrl("https://not-allowlisted.example.net/player")).toBe(false);
  });

  it("rejects a subdomain of an allowlisted host (no wildcard matching)", () => {
    const [firstHost] = EMBED_DOMAIN_ALLOWLIST;
    expect(isAllowlistedEmbedUrl(`https://sub.${firstHost}/player`)).toBe(false);
  });

  it("returns false rather than throwing on a malformed URL", () => {
    expect(() => isAllowlistedEmbedUrl("not a url at all")).not.toThrow();
    expect(isAllowlistedEmbedUrl("not a url at all")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAllowlistedEmbedUrl("")).toBe(false);
  });

  it("ignores the path/query/hash and matches on hostname alone", () => {
    const [firstHost] = EMBED_DOMAIN_ALLOWLIST;
    expect(isAllowlistedEmbedUrl(`https://${firstHost}/deep/path?query=1#hash`)).toBe(true);
  });
});
