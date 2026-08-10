import { describe, expect, it } from "vitest";
import { findEmbedAllowlistDrift, looksLikeEmbeddablePlayerUrl } from "./embed-allowlist-consistency";
import { EMBED_DOMAIN_ALLOWLIST } from "@/components/media-embed/allowlist";
import type { CameraSource } from "./types";

function source(overrides: Partial<Pick<CameraSource, "id" | "name" | "source_url">>): Pick<
  CameraSource,
  "id" | "name" | "source_url"
> {
  return { id: "cam-1", name: "Test Camera", source_url: "https://example.com/stream", ...overrides };
}

describe("looksLikeEmbeddablePlayerUrl", () => {
  it("treats raw stream/still-image extensions as NOT embeddable-player-shaped", () => {
    for (const url of [
      "https://cdn.example.com/stream.m3u8",
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/clip.mov",
      "https://cdn.example.com/clip.webm",
      "https://cdn.example.com/segment.ts",
      "https://cdn.example.com/still.jpg",
      "https://cdn.example.com/still.jpeg",
      "https://cdn.example.com/still.png",
      "https://cdn.example.com/still.webp",
      "https://cdn.example.com/still.gif",
    ]) {
      expect(looksLikeEmbeddablePlayerUrl(url)).toBe(false);
    }
  });

  it("is case-insensitive about the extension", () => {
    expect(looksLikeEmbeddablePlayerUrl("https://cdn.example.com/STILL.JPG")).toBe(false);
  });

  it("treats a page-shaped URL (no raw-media extension) as embeddable-player-shaped", () => {
    expect(looksLikeEmbeddablePlayerUrl("https://embed.example.com/player/site-123")).toBe(true);
  });

  it("treats a malformed URL as embeddable-player-shaped (fails toward requiring the allowlist)", () => {
    expect(looksLikeEmbeddablePlayerUrl("not a url at all")).toBe(true);
  });
});

describe("findEmbedAllowlistDrift", () => {
  it("returns no drift for an empty input", () => {
    expect(findEmbedAllowlistDrift([])).toEqual([]);
  });

  it("skips rows whose source_url looks like raw stream/still media", () => {
    const rows = [source({ id: "cam-1", source_url: "https://cdn.untrusted.example/live.m3u8" })];
    expect(findEmbedAllowlistDrift(rows)).toEqual([]);
  });

  it("skips rows whose hostname is already on EMBED_DOMAIN_ALLOWLIST", () => {
    const allowlistedHost = EMBED_DOMAIN_ALLOWLIST[0];
    const rows = [source({ id: "cam-1", source_url: `https://${allowlistedHost}/player/1` })];
    expect(findEmbedAllowlistDrift(rows)).toEqual([]);
  });

  it("flags an embeddable-shaped row whose hostname is missing from the allowlist", () => {
    const rows = [source({ id: "cam-1", name: "Rogue Cam", source_url: "https://not-allowlisted.example.net/player/1" })];
    const drift = findEmbedAllowlistDrift(rows);
    expect(drift).toEqual([
      { id: "cam-1", name: "Rogue Cam", source_url: "https://not-allowlisted.example.net/player/1", hostname: "not-allowlisted.example.net" },
    ]);
  });

  it("reports a null hostname for a source_url that doesn't even parse as a URL", () => {
    const rows = [source({ id: "cam-1", source_url: "not a url at all" })];
    const drift = findEmbedAllowlistDrift(rows);
    expect(drift).toEqual([{ id: "cam-1", name: "Test Camera", source_url: "not a url at all", hostname: null }]);
  });

  it("lowercases the hostname it reports", () => {
    const rows = [source({ id: "cam-1", source_url: "https://ROGUE.EXAMPLE.NET/player/1" })];
    const drift = findEmbedAllowlistDrift(rows);
    expect(drift[0].hostname).toBe("rogue.example.net");
  });

  it("evaluates a mixed batch independently, flagging only the actual drift", () => {
    const allowlistedHost = EMBED_DOMAIN_ALLOWLIST[0];
    const rows = [
      source({ id: "cam-raw", source_url: "https://cdn.example.com/still.jpg" }),
      source({ id: "cam-ok", source_url: `https://${allowlistedHost}/player/2` }),
      source({ id: "cam-drift", name: "Drift Cam", source_url: "https://sketchy.example.net/embed" }),
    ];
    const drift = findEmbedAllowlistDrift(rows);
    expect(drift.map((d) => d.id)).toEqual(["cam-drift"]);
  });
});
