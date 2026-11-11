import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyManifest } from "./bundle-signing";
import { buildSiteBundle } from "./site-bundle";
import { parseOfflineSitePayload, parseSiteBundleResponse } from "./site-bundle-payload";
import { FIXTURE_HAZARDS, FIXTURE_SITE } from "./test-fixtures";

describe("buildSiteBundle", () => {
  beforeEach(() => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("produces a manifest whose signature and checksum both verify", () => {
    const bundle = buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, false, new Date("2026-11-11T12:00:00.000Z"));

    expect(bundle.manifest.siteId).toBe("site-123");
    expect(bundle.manifest.generatedAt).toBe("2026-11-11T12:00:00.000Z");
    expect(verifyManifest(bundle.manifest, bundle.signature)).toBe(true);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.manifest.files[0].path).toBe(bundle.files[0].path);
    expect(bundle.manifest.files[0].sha256).toBe(
      createHash("sha256").update(bundle.files[0].content, "utf8").digest("hex"),
    );
  });

  it("carries the site and hazards but drops account ids", () => {
    const bundle = buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, true);
    const payload = parseOfflineSitePayload(JSON.parse(bundle.files[0].content));

    expect(payload?.site.name).toBe("Blue Heron Bridge");
    expect(payload?.hazards.map((hazard) => hazard.id)).toEqual(["hazard-1"]);
    expect(payload?.hazardsTruncated).toBe(true);
    expect(bundle.files[0].content).not.toContain("user-1");
    expect(bundle.files[0].content).not.toContain("user-2");
  });

  it("does not mutate its inputs", () => {
    buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, false);
    expect(FIXTURE_SITE.created_by).toBe("user-1");
    expect(FIXTURE_HAZARDS[0].reported_by).toBe("user-2");
  });

  it("rejects a manifest altered after signing", () => {
    const bundle = buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, false);
    const tampered = { ...bundle.manifest, files: [{ ...bundle.manifest.files[0], sha256: "0".repeat(64) }] };
    expect(verifyManifest(tampered, bundle.signature)).toBe(false);
  });

  it("refuses to build an unsigned bundle when the secret is missing", () => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "");
    expect(() => buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, false)).toThrow(/BUNDLE_SIGNING_SECRET/);
  });
});

describe("parseSiteBundleResponse", () => {
  it("rejects malformed envelopes", () => {
    expect(parseSiteBundleResponse(null)).toBeNull();
    expect(parseSiteBundleResponse({ manifest: {}, signature: "x", files: [] })).toBeNull();
    expect(
      parseSiteBundleResponse({
        manifest: { siteId: "a", generatedAt: "now", files: [{ path: "p" }] },
        signature: "x",
        files: [],
      }),
    ).toBeNull();
  });
});

describe("parseOfflineSitePayload", () => {
  const valid = {
    schemaVersion: 1,
    site: { id: "a", name: "A", latitude: 1, longitude: 2 },
    hazards: [],
    hazardsTruncated: false,
  };

  it("accepts a well-formed payload", () => {
    expect(parseOfflineSitePayload(valid)?.site.id).toBe("a");
  });

  it("treats an unknown schema version, bad coordinates, or the old placeholder record as not cached", () => {
    expect(parseOfflineSitePayload({ ...valid, schemaVersion: 2 })).toBeNull();
    expect(parseOfflineSitePayload({ ...valid, site: { ...valid.site, latitude: "26.7" } })).toBeNull();
    expect(parseOfflineSitePayload({ ...valid, hazards: [{ id: "h" }] })).toBeNull();
    expect(parseOfflineSitePayload({ mock: true, note: "Placeholder bundle" })).toBeNull();
  });
});
