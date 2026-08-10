import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryOverpassNearby, upsertSitesFromOsm, type OsmDiveSite } from "./osm-import";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

// ---------------------------------------------------------------------
// queryOverpassNearby — normalizer / entryType-derivation logic against
// fixture Overpass API JSON responses. No live network call: global fetch
// is stubbed per test.
// ---------------------------------------------------------------------

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("queryOverpassNearby", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a mixed fixture response, deriving entryType from scuba_diving:entry and siteType from historic/natural tags", async () => {
    const fixture = {
      elements: [
        {
          type: "node",
          id: 111,
          lat: 26.7753,
          lon: -80.0431,
          tags: { sport: "scuba_diving", name: "Blue Heron Bridge", "scuba_diving:entry": "shore" },
        },
        {
          // historic=wreck -> shipwreck (live-verified tag, see deriveSiteType).
          type: "node",
          id: 222,
          lat: 24.556,
          lon: -81.808,
          tags: {
            sport: "scuba_diving",
            name: "USS Spiegel Grove",
            "scuba_diving:entry": "boat",
            historic: "wreck",
          },
        },
        {
          // No scuba_diving:entry tag at all -> entryType unknown, not guessed.
          // Also no historic/natural tag -> siteType unclassified.
          type: "node",
          id: 333,
          lat: 30.05,
          lon: -85.6,
          tags: { sport: "scuba_diving", name: "Devil's Den" },
        },
        {
          // Unrecognized entry value -> entryType unknown, not misclassified
          // as shore/boat. natural=cave_entrance -> siteType cave.
          type: "node",
          id: 444,
          lat: 27.0,
          lon: -80.2,
          tags: { sport: "scuba_diving", "scuba_diving:entry": "pier", natural: "cave_entrance" },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryOverpassNearby({ latitude: 26.77, longitude: -80.04, radiusMiles: 10 });

    expect(result.error).toBeNull();
    expect(result.sites).toEqual<OsmDiveSite[]>([
      {
        osmId: "111",
        name: "Blue Heron Bridge",
        latitude: 26.7753,
        longitude: -80.0431,
        entryType: "shore",
        siteType: "unclassified",
        osmDescription: null,
        depth: null,
        website: null,
      },
      {
        osmId: "222",
        name: "USS Spiegel Grove",
        latitude: 24.556,
        longitude: -81.808,
        entryType: "boat",
        siteType: "shipwreck",
        osmDescription: null,
        depth: null,
        website: null,
      },
      {
        osmId: "333",
        name: "Devil's Den",
        latitude: 30.05,
        longitude: -85.6,
        entryType: "unknown",
        siteType: "unclassified",
        osmDescription: null,
        depth: null,
        website: null,
      },
      {
        osmId: "444",
        name: null,
        latitude: 27.0,
        longitude: -80.2,
        entryType: "unknown",
        siteType: "cave",
        osmDescription: null,
        depth: null,
        website: null,
      },
    ]);
  });

  it("extracts real description/depth/website tags when present (2026-08-09, founder: 'this should include all data') — fixture matches the real S.S. Inchulva/Delray Wreck node found live", async () => {
    const fixture = {
      elements: [
        {
          type: "node",
          id: 663869458,
          lat: 26.453632,
          lon: -80.056344,
          tags: {
            sport: "scuba_diving",
            name: "S.S. Inchulva / Delray Wreck (Wrack)",
            historic: "wreck",
            description:
              "The old shipwreck know as the Delray Wreck rests at the bottom of the ocean in 25 feet of water about 150 yards offshore the south end of Delray's municipal beach.",
            depth: "25 feet",
            website: "http://www.dive-links.com/tauchplatz.php?id=1983",
          },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture)));

    const result = await queryOverpassNearby({ latitude: 26.45, longitude: -80.05, radiusMiles: 5 });

    expect(result.sites[0].osmDescription).toBe(
      "The old shipwreck know as the Delray Wreck rests at the bottom of the ocean in 25 feet of water about 150 yards offshore the south end of Delray's municipal beach.",
    );
    expect(result.sites[0].depth).toBe("25 feet");
    expect(result.sites[0].website).toBe("http://www.dive-links.com/tauchplatz.php?id=1983");
  });

  it("falls back from depth to max_depth when depth isn't present", async () => {
    const fixture = {
      elements: [{ type: "node", id: 1, lat: 1, lon: 2, tags: { sport: "scuba_diving", max_depth: "12m" } }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture)));

    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });

    expect(result.sites[0].depth).toBe("12m");
  });

  describe("siteType derivation", () => {
    function fixtureFor(tags: Record<string, string>) {
      return { elements: [{ type: "node", id: 1, lat: 1, lon: 2, tags: { sport: "scuba_diving", ...tags } }] };
    }

    it("derives shipwreck from historic=wreck (live-verified: USS Vandenberg, USS Spiegel Grove)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ historic: "wreck" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("shipwreck");
    });

    it("derives cave from natural=cave_entrance (live-verified: Devil's Den)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ natural: "cave_entrance" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("cave");
    });

    it("derives spring from natural=spring (live-verified: Ginnie Spring, Ichetucknee Spring, Rainbow Spring)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ natural: "spring" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("spring");
    });

    it("derives shore_reef from natural=reef", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ natural: "reef" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("shore_reef");
    });

    it("falls to unclassified when no historic/natural tag is present at all, never guessing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({}))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("unclassified");
    });

    it("falls to unclassified for man_made=reef — a real OSM tag, but never found co-occurring with sport=scuba_diving, so deliberately not derived", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ man_made: "reef" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("unclassified");
    });

    it("falls to unclassified for an unrecognized natural= value, not misclassified", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixtureFor({ natural: "beach" }))));
      const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
      expect(result.sites[0].siteType).toBe("unclassified");
    });
  });

  it("filters out elements that aren't usable scuba_diving nodes", async () => {
    const fixture = {
      elements: [
        // Not a node.
        { type: "way", id: 1, tags: { sport: "scuba_diving" } },
        // Not a scuba_diving sport tag.
        { type: "node", id: 2, lat: 1, lon: 2, tags: { sport: "swimming" } },
        // Missing lat/lon.
        { type: "node", id: 3, tags: { sport: "scuba_diving" } },
        // No tags at all.
        { type: "node", id: 4, lat: 1, lon: 2 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture)));

    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });

    expect(result.error).toBeNull();
    expect(result.sites).toEqual([]);
  });

  it("handles an empty/missing elements array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });
    expect(result).toEqual({ sites: [], error: null });
  });

  it("builds the request with a meters radius converted from radiusMiles and around() syntax", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await queryOverpassNearby({ latitude: 26.7, longitude: -80.1, radiusMiles: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init.method).toBe("POST");
    const body = decodeURIComponent(String(init.body).replace(/^data=/, ""));
    expect(body).toContain('sport"="scuba_diving"');
    expect(body).toContain("around:16093"); // 10 miles ≈ 16093m, rounded
    expect(body).toContain("26.7,-80.1");
  });

  it("degrades to an error, never throwing, on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 503 })));

    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });

    expect(result.sites).toEqual([]);
    expect(result.error).toBe("Overpass API returned 503");
  });

  it("degrades to an error, never throwing, when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network error")),
    );

    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });

    expect(result.sites).toEqual([]);
    expect(result.error).toBe("network error");
  });

  it("degrades to an error, never throwing, when the response body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as unknown as Response),
    );

    const result = await queryOverpassNearby({ latitude: 1, longitude: 2, radiusMiles: 5 });

    expect(result.sites).toEqual([]);
    expect(result.error).toContain("Unexpected token");
  });
});

// ---------------------------------------------------------------------
// upsertSitesFromOsm — not-confirmed-boat-only filter, dedup-by-external_id
// logic, mocked Supabase admin client (no live DB).
// ---------------------------------------------------------------------

/** Real supabase-js `PostgrestError`s extend `Error` (they carry `message`
 * via the `Error` constructor plus a `code` field) — build fixtures that
 * match, so `errorMessage()`'s `error instanceof Error` branch in
 * osm-import.ts is exercised the same way it would be against a live
 * Supabase error, not a plain object literal. */
function postgrestError(message: string, code?: string): Error & { code?: string } {
  return Object.assign(new Error(message), code ? { code } : {});
}

function site(overrides: Partial<OsmDiveSite> = {}): OsmDiveSite {
  return {
    osmId: "1",
    name: "Test Site",
    latitude: 26.7,
    longitude: -80.1,
    entryType: "shore",
    siteType: "unclassified",
    osmDescription: null,
    depth: null,
    website: null,
    ...overrides,
  };
}

/** A minimal thenable Supabase query-builder mock: chainable, and resolves
 * to a fixed `{ data, error }` result when awaited — matching how the real
 * supabase-js client is used in osm-import.ts (chained filters, awaited
 * once at the end). `admin.from()` hands out one canned result per call, in
 * the order `responses` lists them, so a test can script "the pre-check
 * select returns X, then the insert returns Y" without caring which table
 * name was passed. */
function createSequencedAdmin(responses: Array<{ data: unknown; error: unknown }>) {
  let call = 0;
  const from = vi.fn(() => {
    const result = responses[call] ?? { data: null, error: null };
    call += 1;
    const resultPromise = Promise.resolve(result);
    const builder: PromiseLike<{ data: unknown; error: unknown }> & Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      insert: () => builder,
      then: resultPromise.then.bind(resultPromise),
    };
    return builder;
  });
  return { from };
}

const mockCreateAdminClient = vi.mocked(createAdminClient);

describe("upsertSitesFromOsm", () => {
  beforeEach(() => {
    mockCreateAdminClient.mockReset();
  });

  it("returns immediately without touching Supabase when every site is confirmed boat-only", async () => {
    const result = await upsertSitesFromOsm([site({ entryType: "boat" }), site({ osmId: "2", entryType: "boat" })]);
    expect(result).toEqual({ inserted: 0, skipped: 2, error: null });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it("imports shore AND unknown-entry sites, skipping only confirmed boat entries — widened 2026-08-09 after a live Fort Lauderdale search found real OSM dive nodes (two genuine shipwrecks) with no scuba_diving:entry tag at all, which turned out to be the norm, not an edge case; a shore-only filter meant the import pipeline imported nothing anywhere it was actually tried", async () => {
    const admin = createSequencedAdmin([
      { data: [], error: null }, // pre-check: none already imported
      { data: [{ id: "new-1" }, { id: "new-2" }], error: null }, // insert: two rows inserted (shore + unknown)
    ]);
    mockCreateAdminClient.mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([
      site({ osmId: "1", entryType: "shore" }),
      site({ osmId: "2", entryType: "boat" }),
      site({ osmId: "3", entryType: "unknown" }),
    ]);

    expect(result).toEqual({ inserted: 2, skipped: 1, error: null });
  });

  it("skips external_ids that already exist locally", async () => {
    const admin = createSequencedAdmin([
      { data: [{ external_id: "1" }], error: null }, // pre-check: id 1 already imported
    ]);
    mockCreateAdminClient.mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([site({ osmId: "1", entryType: "shore" })]);

    // toInsert is empty after filtering out the already-existing id, so the
    // function returns before ever calling insert (only one queued
    // response was needed above).
    expect(result).toEqual({ inserted: 0, skipped: 1, error: null });
  });

  it("inserts new shore sites tagged COMMUNITY provenance and null legal_access_status", async () => {
    let insertedRows: unknown;
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {
        select: (columns: string) => {
          if (columns === "external_id") {
            return {
              eq: () => ({
                in: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          }
          return Promise.resolve({ data: insertedRows, error: null });
        },
        insert: (rows: unknown) => {
          insertedRows = rows;
          return builder;
        },
      };
      return builder;
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([
      site({ osmId: "9", name: "New Reef", entryType: "shore", siteType: "shore_reef" }),
    ]);

    expect(result.error).toBeNull();
    expect(result.inserted).toBe(1);
    expect(insertedRows).toEqual([
      expect.objectContaining({
        name: "New Reef",
        provenance: "COMMUNITY",
        legal_access_status: null,
        site_type: "shore_reef",
        external_source: "osm",
        external_id: "9",
      }),
    ]);
    expect((insertedRows as Array<{ description: string }>)[0].description).toContain("OpenStreetMap");
  });

  it("falls back to per-row inserts and skips (not errors) on a duplicate race", async () => {
    let insertCalls = 0;
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        insert: (rows: unknown) => {
          insertCalls += 1;
          if (Array.isArray(rows)) {
            // The batch insert path: simulate a race unique_violation.
            return {
              select: () => Promise.resolve({ data: null, error: postgrestError("duplicate key", "23505") }),
            };
          }
          // Fallback per-row insert path: first row "wins", second row is
          // the one that actually raced.
          const isSecondRow = insertCalls > 2; // 1 batch call + 2 individual calls
          return Promise.resolve(
            isSecondRow ? { error: postgrestError("duplicate key", "23505") } : { error: null },
          );
        },
      };
      return builder;
    });
    mockCreateAdminClient.mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([
      site({ osmId: "10", entryType: "shore" }),
      site({ osmId: "11", entryType: "shore" }),
    ]);

    expect(result.error).toBeNull();
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("returns an error, never throws, when the pre-check select fails", async () => {
    const admin = createSequencedAdmin([{ data: null, error: postgrestError("connection reset") }]);
    mockCreateAdminClient.mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([site({ osmId: "1", entryType: "shore" })]);

    expect(result.inserted).toBe(0);
    expect(result.error).toBe("connection reset");
  });

  it("returns an error, never throws, when createAdminClient itself throws", async () => {
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });

    const result = await upsertSitesFromOsm([site({ osmId: "1", entryType: "shore" })]);

    expect(result).toEqual({ inserted: 0, skipped: 0, error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
  });

  it("returns an error, never throws, on a non-duplicate batch insert failure", async () => {
    const admin = createSequencedAdmin([
      { data: [], error: null },
      { data: null, error: postgrestError("permission denied", "42501") },
    ]);
    mockCreateAdminClient.mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

    const result = await upsertSitesFromOsm([site({ osmId: "1", entryType: "shore" })]);

    expect(result.inserted).toBe(0);
    expect(result.error).toBe("permission denied");
  });
});
