import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedSiteRecord } from "@/lib/db";
import { verifyManifest } from "./bundle-signing";
import { prefetchSite, refreshStaleSavedSites, type CachedSite, type PrefetchDeps } from "./prefetch-site";
import { buildSiteBundle } from "./site-bundle";
import type { SiteBundleResponse } from "./site-bundle-payload";
import { FIXTURE_HAZARDS, FIXTURE_SITE } from "./test-fixtures";

const NOW = new Date("2026-11-11T12:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Deps wired to the real signing code, with a recording `save`. */
function setup(respond: () => Response | Promise<Response>, overrides: PrefetchDeps = {}) {
  const saved: CachedSiteRecord[] = [];
  const deps: PrefetchDeps = {
    fetch: vi.fn(async () => respond()) as unknown as typeof fetch,
    save: async (record) => {
      saved.push(record);
    },
    verifySignature: async (manifest, signature) => verifyManifest(manifest, signature),
    now: () => NOW,
    isOnline: () => true,
    ...overrides,
  };
  return { deps, saved };
}

describe("prefetchSite", () => {
  let bundle: SiteBundleResponse;

  beforeEach(() => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "test-secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    bundle = buildSiteBundle(FIXTURE_SITE, FIXTURE_HAZARDS, false, NOW);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("saves a verified bundle with the real time of caching", async () => {
    const { deps, saved } = setup(() => jsonResponse(bundle));

    const result = await prefetchSite("site-123", deps);

    expect(result).toEqual({ ok: true, cachedAt: NOW, hazardCount: 1 });
    expect(deps.fetch).toHaveBeenCalledWith("/api/sites/site-123/offline-bundle", { cache: "no-store" });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "site-123", name: "Blue Heron Bridge", cachedAt: NOW });
    expect((saved[0].data.hazards as unknown[]).length).toBe(1);
  });

  it("does not touch the network when offline", async () => {
    const { deps, saved } = setup(() => jsonResponse(bundle), { isOnline: () => false });

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "offline" });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it.each([
    [503, "not-configured"],
    [404, "not-found"],
    [500, "network"],
  ] as const)("maps HTTP %i to %s without saving", async (status, reason) => {
    const { deps, saved } = setup(() => jsonResponse({ error: "x" }, status));

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason });
    expect(saved).toHaveLength(0);
  });

  it("treats a thrown fetch as a network failure", async () => {
    const { deps, saved } = setup(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "network" });
    expect(saved).toHaveLength(0);
  });

  it("fails closed when file content was tampered with in transit", async () => {
    const tampered = {
      ...bundle,
      files: [{ ...bundle.files[0], content: bundle.files[0].content.replace("Strong current", "No current") }],
    };
    const { deps, saved } = setup(() => jsonResponse(tampered));

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "verification-failed" });
    expect(saved).toHaveLength(0);
  });

  it("fails closed when the signature does not verify", async () => {
    const { deps, saved } = setup(() => jsonResponse({ ...bundle, signature: "00".repeat(32) }));

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "verification-failed" });
    expect(saved).toHaveLength(0);
  });

  it("fails closed when the signature check itself is unreachable", async () => {
    const { deps, saved } = setup(() => jsonResponse(bundle), {
      verifySignature: async () => {
        throw new Error("network down");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "verification-failed" });
    expect(saved).toHaveLength(0);
  });

  it("rejects a validly-signed bundle for a different site", async () => {
    const { deps, saved } = setup(() => jsonResponse(bundle));

    expect(await prefetchSite("some-other-site", deps)).toEqual({ ok: false, reason: "invalid-bundle" });
    expect(saved).toHaveLength(0);
  });

  it("rejects a response that isn't a bundle at all", async () => {
    const { deps, saved } = setup(() => jsonResponse({ hello: "world" }));

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "invalid-bundle" });
    expect(saved).toHaveLength(0);
  });

  it("reports a storage failure instead of claiming success", async () => {
    const { deps } = setup(() => jsonResponse(bundle), {
      save: async () => {
        throw new Error("QuotaExceededError");
      },
    });

    expect(await prefetchSite("site-123", deps)).toEqual({ ok: false, reason: "storage" });
  });
});

describe("refreshStaleSavedSites", () => {
  const HOUR = 60 * 60 * 1000;
  const saved = (id: string, ageHours: number): CachedSite => ({
    payload: { schemaVersion: 1, site: { ...FIXTURE_SITE, id }, hazards: [], hazardsTruncated: false },
    cachedAt: new Date(NOW.getTime() - ageHours * HOUR),
  });
  const listOf = (sites: CachedSite[]) => async () => ({ sites, error: null });

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("refreshes only stale copies, stalest first", async () => {
    const prefetch = vi.fn(async (siteId: string) => ({ ok: true as const, cachedAt: NOW, hazardCount: siteId.length * 0 }));

    const result = await refreshStaleSavedSites({
      list: listOf([saved("fresh", 1), saved("old", 30), saved("older", 80)]),
      prefetch,
      now: () => NOW,
      isOnline: () => true,
    });

    expect(result).toEqual({ refreshed: 2, failed: 0 });
    expect(prefetch.mock.calls.map(([id]) => id)).toEqual(["older", "old"]);
  });

  it("does nothing offline", async () => {
    const prefetch = vi.fn();
    const result = await refreshStaleSavedSites({
      list: listOf([saved("old", 30)]),
      prefetch,
      now: () => NOW,
      isOnline: () => false,
    });
    expect(result).toEqual({ refreshed: 0, failed: 0 });
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("stops after the first server-side failure instead of retrying every site", async () => {
    const prefetch = vi.fn(async () => ({ ok: false as const, reason: "network" as const }));
    const result = await refreshStaleSavedSites({
      list: listOf([saved("a", 30), saved("b", 40), saved("c", 50)]),
      prefetch,
      now: () => NOW,
      isOnline: () => true,
    });
    expect(result).toEqual({ refreshed: 0, failed: 1 });
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("caps how many sites one run refreshes", async () => {
    const prefetch = vi.fn(async (siteId: string) => ({ ok: true as const, cachedAt: NOW, hazardCount: siteId.length * 0 }));
    const many = Array.from({ length: 25 }, (_, index) => saved(`site-${index}`, 30 + index));
    await refreshStaleSavedSites({ list: listOf(many), prefetch, now: () => NOW, isOnline: () => true });
    expect(prefetch).toHaveBeenCalledTimes(10);
  });
});
