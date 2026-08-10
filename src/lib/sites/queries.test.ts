import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SITE_QUERY_LIMIT,
  HAZARD_FLAG_QUERY_LIMIT,
  MAX_SITE_QUERY_LIMIT,
  SITE_DETAIL_HAZARD_LIMIT,
  getSiteWithHazards,
  listSitesInBounds,
  listSitesWithHazardFlag,
} from "./queries";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

// ---------------------------------------------------------------------
// Mocked Supabase server client — no live DB, same approach as
// osm-import.test.ts's `createSequencedAdmin`, but recording *which* query
// builder methods were called with what, since the whole point of T21.12 is
// that the filtering/limiting happens server-side (in the query) rather than
// in JavaScript after a full-table read. Asserting on the returned rows alone
// could not tell those two apart.
// ---------------------------------------------------------------------

interface QueryCall {
  table: string;
  method: string;
  args: unknown[];
}

type CannedResult = { data: unknown; error: unknown };

const CHAINABLE = ["select", "order", "gte", "lte", "or", "in", "eq", "limit"] as const;

function createRecordingClient(results: Record<string, CannedResult> = {}) {
  const calls: QueryCall[] = [];

  const from = vi.fn((table: string) => {
    calls.push({ table, method: "from", args: [table] });
    const result = results[table] ?? { data: [], error: null };
    const resultPromise = Promise.resolve(result);

    const builder: Record<string, unknown> = {};
    for (const method of CHAINABLE) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    }
    // `.returns<T>()` is the terminal call in queries.ts — it resolves to the
    // canned `{ data, error }` the real supabase-js builder would.
    builder.returns = () => {
      calls.push({ table, method: "returns", args: [] });
      return resultPromise;
    };
    // The other terminal call in queries.ts — `getSiteWithHazards`'s single-
    // site read ends in `.maybeSingle<RawSiteRow>()` rather than `.returns()`,
    // and resolves to the same `{ data, error }` shape (with `data` being one
    // row or null, not an array).
    builder.maybeSingle = () => {
      calls.push({ table, method: "maybeSingle", args: [] });
      return resultPromise;
    };
    return builder;
  });

  const client = { from } as unknown as Awaited<ReturnType<typeof createClient>>;
  return {
    client,
    calls,
    /** Every recorded call for one table+method, in call order. */
    callsFor(table: string, method: string) {
      return calls.filter((call) => call.table === table && call.method === method);
    },
    tablesQueried() {
      return calls.filter((call) => call.method === "from").map((call) => call.table);
    },
  };
}

function useClient(results?: Record<string, CannedResult>) {
  const recorder = createRecordingClient(results);
  mockCreateClient.mockResolvedValue(recorder.client);
  return recorder;
}

/** Real supabase-js `PostgrestError`s extend `Error`; match that so
 * `errorMessage()`'s `instanceof Error` branch is exercised the same way it
 * would be live (same fixture rationale as osm-import.test.ts). */
function postgrestError(message: string): Error {
  return new Error(message);
}

function siteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "site-1",
    name: "Alpha Cove",
    latitude: 26.7,
    longitude: -80.1,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "unclassified",
    ...overrides,
  };
}

/** N distinct site rows, for limit/truncation-boundary tests. */
function siteRows(count: number) {
  return Array.from({ length: count }, (_, i) => siteRow({ id: `site-${i}`, name: `Site ${i}` }));
}

const FLORIDA_BOX = { north: 27, south: 26, east: -80, west: -81 };

beforeEach(() => {
  mockCreateClient.mockReset();
  // The structured logger writes real JSON to console.warn/error; silence it
  // so test output stays readable, while still asserting it fired.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------
// listSitesInBounds — the bounded replacement for "select everything, then
// filter by radius in JavaScript".
// ---------------------------------------------------------------------

describe("listSitesInBounds", () => {
  it("filters latitude AND longitude server-side, in the query, for a normal (non-wrapping) box", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result.error).toBeNull();
    expect(recorder.callsFor("sites", "gte").map((c) => c.args)).toEqual([
      ["latitude", 26],
      ["longitude", -81],
    ]);
    expect(recorder.callsFor("sites", "lte").map((c) => c.args)).toEqual([
      ["latitude", 27],
      ["longitude", -80],
    ]);
    // A normal box must NOT use the antimeridian `or=(...)` form.
    expect(recorder.callsFor("sites", "or")).toHaveLength(0);
  });

  it("applies an explicit default limit to the sites query", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    await listSitesInBounds(FLORIDA_BOX);

    expect(recorder.callsFor("sites", "limit").map((c) => c.args)).toEqual([[DEFAULT_SITE_QUERY_LIMIT]]);
  });

  it("passes a caller-supplied limit through", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    await listSitesInBounds({ ...FLORIDA_BOX, limit: 25 });

    expect(recorder.callsFor("sites", "limit")[0].args).toEqual([25]);
  });

  it("clamps a limit above PostgREST's own row ceiling — asking for more than the server will ever return would be a lie", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    await listSitesInBounds({ ...FLORIDA_BOX, limit: 100_000 });

    expect(recorder.callsFor("sites", "limit")[0].args).toEqual([MAX_SITE_QUERY_LIMIT]);
  });

  it("clamps a zero/negative limit up to 1, and falls back to the default for a non-finite one — never to unbounded", async () => {
    const zero = useClient({ sites: { data: [], error: null } });
    await listSitesInBounds({ ...FLORIDA_BOX, limit: 0 });
    expect(zero.callsFor("sites", "limit")[0].args).toEqual([1]);

    const nan = useClient({ sites: { data: [], error: null } });
    await listSitesInBounds({ ...FLORIDA_BOX, limit: Number.NaN });
    expect(nan.callsFor("sites", "limit")[0].args).toEqual([DEFAULT_SITE_QUERY_LIMIT]);
  });

  it("scopes the hazard_reports read to the site ids actually returned, and bounds it — not a second full-table read", async () => {
    const recorder = useClient({
      sites: { data: [siteRow({ id: "a" }), siteRow({ id: "b" })], error: null },
      hazard_reports: { data: [{ site_id: "b" }], error: null },
    });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(recorder.callsFor("hazard_reports", "in").map((c) => c.args)).toEqual([["site_id", ["a", "b"]]]);
    expect(recorder.callsFor("hazard_reports", "limit").map((c) => c.args)).toEqual([[HAZARD_FLAG_QUERY_LIMIT]]);
    expect(result.sites.map((s) => [s.id, s.hasHazardReport])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  it("skips the hazard_reports round trip entirely when the bounds returned no sites", async () => {
    const recorder = useClient({ sites: { data: [], error: null } });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result).toEqual({ sites: [], truncated: false, error: null });
    expect(recorder.tablesQueried()).toEqual(["sites"]);
  });

  it("coerces PostgREST numeric-as-string coordinates to real numbers", async () => {
    useClient({ sites: { data: [siteRow({ latitude: "26.7753", longitude: "-80.0431" })], error: null } });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result.sites[0].latitude).toBe(26.7753);
    expect(result.sites[0].longitude).toBe(-80.0431);
  });

  describe("truncation", () => {
    it("does not flag a result that came back under the limit", async () => {
      useClient({ sites: { data: siteRows(9), error: null } });

      const result = await listSitesInBounds({ ...FLORIDA_BOX, limit: 10 });

      expect(result.truncated).toBe(false);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("flags exactly at the limit boundary and logs a structured warning", async () => {
      useClient({ sites: { data: siteRows(10), error: null } });

      const result = await listSitesInBounds({ ...FLORIDA_BOX, limit: 10 });

      expect(result.truncated).toBe(true);
      expect(result.sites).toHaveLength(10);
      expect(console.warn).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string);
      expect(logged).toMatchObject({
        level: "warn",
        scope: "sites",
        event: "sites.bounds_truncated",
        siteCount: 10,
        siteLimit: 10,
        sitesTruncated: true,
        hazardsTruncated: false,
      });
    });

    it("also flags when the hazard read hits its own ceiling — an under-reported hazard flag fails toward looking safer than reality", async () => {
      useClient({
        sites: { data: siteRows(2), error: null },
        hazard_reports: {
          data: Array.from({ length: HAZARD_FLAG_QUERY_LIMIT }, () => ({ site_id: "site-0" })),
          error: null,
        },
      });

      const result = await listSitesInBounds({ ...FLORIDA_BOX, limit: 500 });

      expect(result.truncated).toBe(true);
      const logged = JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string);
      expect(logged).toMatchObject({ sitesTruncated: false, hazardsTruncated: true });
    });
  });

  describe("antimeridian (±180°) boxes", () => {
    it("expresses a wrapping box (west > east) as an OR, so Pacific users don't silently get zero results", async () => {
      const recorder = useClient({ sites: { data: [siteRow({ longitude: 179.5 })], error: null } });

      const result = await listSitesInBounds({ north: 20, south: -20, west: 170, east: -170 });

      expect(result.error).toBeNull();
      expect(recorder.callsFor("sites", "or").map((c) => c.args)).toEqual([
        ["longitude.gte.170,longitude.lte.-170"],
      ]);
      // Latitude is still a plain conjunction — latitude never wraps.
      expect(recorder.callsFor("sites", "gte").map((c) => c.args)).toEqual([["latitude", -20]]);
      expect(recorder.callsFor("sites", "lte").map((c) => c.args)).toEqual([["latitude", 20]]);
    });

    it("does not emit an unsatisfiable longitude conjunction for a wrapping box", async () => {
      const recorder = useClient({ sites: { data: [], error: null } });

      await listSitesInBounds({ north: 20, south: -20, west: 170, east: -170 });

      const longitudeConjunctions = [
        ...recorder.callsFor("sites", "gte"),
        ...recorder.callsFor("sites", "lte"),
      ].filter((call) => call.args[0] === "longitude");
      expect(longitudeConjunctions).toEqual([]);
    });
  });

  describe("invalid bounds", () => {
    it("rejects a non-finite edge before issuing any query, rather than returning a zero-row answer indistinguishable from 'no sites here'", async () => {
      const recorder = useClient();

      const result = await listSitesInBounds({ ...FLORIDA_BOX, north: Number.NaN });

      expect(result.sites).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.error).toContain("finite numbers");
      expect(recorder.calls).toEqual([]);
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("rejects an inverted latitude box (north below south) before querying", async () => {
      const recorder = useClient();

      const result = await listSitesInBounds({ north: 10, south: 20, east: 5, west: -5 });

      expect(result.sites).toEqual([]);
      expect(result.error).toContain("north (10) is south of south (20)");
      expect(recorder.calls).toEqual([]);
    });
  });

  describe("error paths", () => {
    it("returns { sites: [], error }, never throws, when the sites query fails", async () => {
      useClient({ sites: { data: null, error: postgrestError("connection reset") } });

      const result = await listSitesInBounds(FLORIDA_BOX);

      expect(result).toEqual({ sites: [], truncated: false, error: "connection reset" });
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("returns { sites: [], error }, never throws, when the scoped hazard query fails", async () => {
      useClient({
        sites: { data: [siteRow()], error: null },
        hazard_reports: { data: null, error: postgrestError("permission denied") },
      });

      const result = await listSitesInBounds(FLORIDA_BOX);

      expect(result).toEqual({ sites: [], truncated: false, error: "permission denied" });
    });

    it("returns { sites: [], error }, never throws, when createClient itself throws (missing env vars)", async () => {
      mockCreateClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));

      const result = await listSitesInBounds(FLORIDA_BOX);

      expect(result).toEqual({ sites: [], truncated: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL" });
    });
  });
});

// ---------------------------------------------------------------------
// listSitesWithHazardFlag — kept (the homepage is a Server Component with no
// user coordinates available), but no longer unbounded.
// ---------------------------------------------------------------------

describe("listSitesWithHazardFlag", () => {
  it("applies an explicit limit to BOTH the sites and hazard_reports queries", async () => {
    const recorder = useClient({
      sites: { data: [siteRow()], error: null },
      hazard_reports: { data: [], error: null },
    });

    await listSitesWithHazardFlag();

    expect(recorder.callsFor("sites", "limit").map((c) => c.args)).toEqual([[DEFAULT_SITE_QUERY_LIMIT]]);
    expect(recorder.callsFor("hazard_reports", "limit").map((c) => c.args)).toEqual([[HAZARD_FLAG_QUERY_LIMIT]]);
  });

  it("stays geographically unfiltered — it is the deliberate no-coordinates-available path", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    await listSitesWithHazardFlag();

    expect(recorder.callsFor("sites", "gte")).toHaveLength(0);
    expect(recorder.callsFor("sites", "lte")).toHaveLength(0);
  });

  it("derives hasHazardReport and coerces numeric-as-string coordinates", async () => {
    useClient({
      sites: {
        data: [siteRow({ id: "a", latitude: "26.7" }), siteRow({ id: "b", name: "Beta" })],
        error: null,
      },
      hazard_reports: { data: [{ site_id: "a" }], error: null },
    });

    const result = await listSitesWithHazardFlag();

    expect(result.truncated).toBe(false);
    expect(result.error).toBeNull();
    expect(result.sites[0]).toMatchObject({ id: "a", latitude: 26.7, hasHazardReport: true });
    expect(result.sites[1]).toMatchObject({ id: "b", hasHazardReport: false });
  });

  it("does not flag truncation below the limit", async () => {
    useClient({ sites: { data: siteRows(DEFAULT_SITE_QUERY_LIMIT - 1), error: null } });

    const result = await listSitesWithHazardFlag();

    expect(result.truncated).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("flags truncation exactly at the limit boundary and warns, so a caller can never present a partial list as complete", async () => {
    useClient({ sites: { data: siteRows(DEFAULT_SITE_QUERY_LIMIT), error: null } });

    const result = await listSitesWithHazardFlag();

    expect(result.truncated).toBe(true);
    expect(result.sites).toHaveLength(DEFAULT_SITE_QUERY_LIMIT);
    const logged = JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: "warn",
      event: "sites.list_truncated",
      siteCount: DEFAULT_SITE_QUERY_LIMIT,
      sitesTruncated: true,
      hazardsTruncated: false,
    });
  });

  it("flags truncation when the hazard read hits its ceiling, even if the sites read did not", async () => {
    useClient({
      sites: { data: siteRows(3), error: null },
      hazard_reports: {
        data: Array.from({ length: HAZARD_FLAG_QUERY_LIMIT }, () => ({ site_id: "site-0" })),
        error: null,
      },
    });

    const result = await listSitesWithHazardFlag();

    expect(result.truncated).toBe(true);
    const logged = JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string);
    expect(logged).toMatchObject({ sitesTruncated: false, hazardsTruncated: true });
  });

  it("returns { sites: [], error }, never throws, when the sites query fails", async () => {
    useClient({ sites: { data: null, error: postgrestError("column sites.site_type does not exist") } });

    const result = await listSitesWithHazardFlag();

    expect(result).toEqual({
      sites: [],
      truncated: false,
      error: "column sites.site_type does not exist",
    });
  });

  it("returns { sites: [], error }, never throws, when the hazard query fails", async () => {
    useClient({
      sites: { data: [siteRow()], error: null },
      hazard_reports: { data: null, error: postgrestError("hazard read failed") },
    });

    const result = await listSitesWithHazardFlag();

    expect(result).toEqual({ sites: [], truncated: false, error: "hazard read failed" });
  });

  it("returns { sites: [], error }, never throws, when createClient itself throws", async () => {
    mockCreateClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY"));

    const result = await listSitesWithHazardFlag();

    expect(result).toEqual({ sites: [], truncated: false, error: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY" });
  });
});

// ---------------------------------------------------------------------
// SITE_MARKER_COLUMNS — the map-pin column list (T21.21). Asserted exactly,
// for the same reason the detail list is: the constant exists so a
// schema/code mismatch fails loudly at the query rather than silently, and a
// test that only checked "contains site_type" would not notice a column
// quietly disappearing from it.
//
// The second assertion here is the one that protects a *product* property
// rather than a correctness one: this list is fetched for every pin in the
// viewport, so the detail-page-only explanation columns must stay out of it.
// ---------------------------------------------------------------------

describe("map-pin column list", () => {
  const MARKER_COLUMNS = [
    "depth_max_ft",
    "depth_min_ft",
    "id",
    "latitude",
    "legal_access_status",
    "longitude",
    "name",
    "provenance",
    "shore_access",
    "site_type",
  ];

  it("names exactly the columns a pin needs, in both marker queries", async () => {
    const bounded = useClient({ sites: { data: [siteRow()], error: null } });
    await listSitesInBounds(FLORIDA_BOX);
    const boundedColumns = bounded.callsFor("sites", "select")[0].args[0] as string;

    const unbounded = useClient({ sites: { data: [siteRow()], error: null } });
    await listSitesWithHazardFlag();
    const unboundedColumns = unbounded.callsFor("sites", "select")[0].args[0] as string;

    expect(boundedColumns).not.toBe("*");
    expect(boundedColumns).toBe(unboundedColumns);
    expect(boundedColumns.split(",").map((c) => c.trim()).sort()).toEqual(MARKER_COLUMNS);
  });

  it("leaves the detail-only shore-access explanation columns out — every pin in view pays for this list", async () => {
    const recorder = useClient({ sites: { data: [siteRow()], error: null } });

    await listSitesInBounds(FLORIDA_BOX);

    const selected = recorder.callsFor("sites", "select")[0].args[0] as string;
    expect(selected).not.toContain("shore_entry_id");
    expect(selected).not.toContain("shore_distance_yards");
    expect(selected).not.toContain("description");
  });

  it("coerces numeric-as-string depths, and keeps 'not recorded' as null rather than 0", async () => {
    useClient({
      sites: {
        data: [
          siteRow({ id: "a", depth_min_ft: "15.0", depth_max_ft: "30.5", shore_access: "likely" }),
          siteRow({ id: "b", depth_min_ft: null, depth_max_ft: null, shore_access: null }),
        ],
        error: null,
      },
    });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result.sites[0]).toMatchObject({
      depth_min_ft: 15,
      depth_max_ft: 30.5,
      shore_access: "likely",
    });
    expect(result.sites[1]).toMatchObject({
      depth_min_ft: null,
      depth_max_ft: null,
      shore_access: null,
    });
  });

  it("degrades an unparseable depth to null ('not recorded'), never to NaN", async () => {
    // NaN would sail straight past every comparison in
    // classifyDiveSuitability() (`NaN > 130` is false) and produce a
    // confident-sounding "within recreational limits" summary for a site
    // whose depth is in fact unknown.
    useClient({ sites: { data: [siteRow({ depth_min_ft: "deep", depth_max_ft: "" })], error: null } });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result.sites[0].depth_min_ft).toBeNull();
    expect(result.sites[0].depth_max_ft).toBeNull();
  });

  it("normalizes a row read before 0012 is applied (columns absent) to explicit nulls", async () => {
    // Every environment is in this state today — 0012 is written but not yet
    // applied to any live project (supabase/README.md Open item #15). The
    // select would error in that case; this covers the milder shape where a
    // row simply arrives without the keys.
    useClient({ sites: { data: [siteRow()], error: null } });

    const result = await listSitesInBounds(FLORIDA_BOX);

    expect(result.sites[0]).toMatchObject({
      depth_min_ft: null,
      depth_max_ft: null,
      shore_access: null,
    });
  });
});

// ---------------------------------------------------------------------
// getSiteWithHazards — T21.16. Two defense-in-depth fixes: explicit column
// lists instead of `select("*")` (so a schema/code mismatch fails loudly
// here the way it already does in the two functions above, rather than
// being masked by `*` returning whatever exists), and a bounded hazard read
// with the same truncation-reporting convention.
// ---------------------------------------------------------------------

/** The full `sites` row shape the detail read returns — every field of
 * `Site`, unlike `siteRow()`'s marker subset. */
function siteDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "site-1",
    name: "Alpha Cove",
    description: "A sheltered entry.",
    latitude: 26.7,
    longitude: -80.1,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "unclassified",
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function hazardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "hazard-1",
    site_id: "site-1",
    provenance: "COMMUNITY",
    description: "Strong outgoing current near the jetty.",
    reported_by: null,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function hazardRows(count: number) {
  return Array.from({ length: count }, (_, i) => hazardRow({ id: `hazard-${i}` }));
}

describe("getSiteWithHazards", () => {
  describe("explicit column lists (no select(*))", () => {
    it("names every sites column it needs instead of selecting *", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      const selected = recorder.callsFor("sites", "select")[0].args[0] as string;
      expect(selected).not.toBe("*");
      expect(selected.split(",").map((c) => c.trim()).sort()).toEqual(
        [
          "created_at",
          "created_by",
          "depth_max_ft",
          "depth_min_ft",
          "description",
          "id",
          "latitude",
          "legal_access_status",
          "longitude",
          "name",
          "provenance",
          "shore_access",
          "shore_distance_yards",
          "shore_entry_id",
          "site_type",
          "updated_at",
        ],
      );
    });

    it("names every hazard_reports column it needs instead of selecting *", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      const selected = recorder.callsFor("hazard_reports", "select")[0].args[0] as string;
      expect(selected).not.toBe("*");
      expect(selected.split(",").map((c) => c.trim()).sort()).toEqual([
        "created_at",
        "description",
        "id",
        "provenance",
        "reported_by",
        "site_id",
        "updated_at",
      ]);
    });

    it("covers every Site field the detail page renders — the column list is what the page's data actually comes from", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      const selected = recorder.callsFor("sites", "select")[0].args[0] as string;
      // `src/app/sites/[id]/page.tsx` reads exactly these off `site`.
      for (const rendered of ["id", "name", "description", "latitude", "longitude", "provenance", "legal_access_status"]) {
        expect(selected).toContain(rendered);
      }
    });

    it("does not request columns that aren't on the Site type (external_source/external_id are import bookkeeping)", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      const selected = recorder.callsFor("sites", "select")[0].args[0] as string;
      expect(selected).not.toContain("external_source");
      expect(selected).not.toContain("external_id");
    });
  });

  describe("scoping and bounding", () => {
    it("scopes both reads to the requested id", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-42");

      expect(recorder.callsFor("sites", "eq").map((c) => c.args)).toEqual([["id", "site-42"]]);
      expect(recorder.callsFor("hazard_reports", "eq").map((c) => c.args)).toEqual([["site_id", "site-42"]]);
    });

    it("bounds the hazard read with an explicit limit", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      expect(recorder.callsFor("hazard_reports", "limit").map((c) => c.args)).toEqual([
        [SITE_DETAIL_HAZARD_LIMIT],
      ]);
    });

    it("orders hazards newest-first, so truncation drops the oldest reports rather than today's", async () => {
      const recorder = useClient({ sites: { data: siteDetailRow(), error: null } });

      await getSiteWithHazards("site-1");

      expect(recorder.callsFor("hazard_reports", "order").map((c) => c.args)).toEqual([
        ["created_at", { ascending: false }],
      ]);
    });

    it("uses a limit at or under PostgREST's own row ceiling, so the number is real rather than silently re-imposed", () => {
      expect(SITE_DETAIL_HAZARD_LIMIT).toBeLessThanOrEqual(MAX_SITE_QUERY_LIMIT);
      // A deliberately tighter sibling of the flag-query ceiling: this read
      // pulls whole rows (prose descriptions) for a single site, not one uuid
      // per row across every site.
      expect(SITE_DETAIL_HAZARD_LIMIT).toBeLessThan(HAZARD_FLAG_QUERY_LIMIT);
    });
  });

  describe("truncation", () => {
    it("does not flag a hazard list that came back under the limit", async () => {
      useClient({
        sites: { data: siteDetailRow(), error: null },
        hazard_reports: { data: hazardRows(3), error: null },
      });

      const result = await getSiteWithHazards("site-1");

      expect(result.truncated).toBe(false);
      expect(result.hazards).toHaveLength(3);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("flags exactly at the limit boundary and logs a structured warning", async () => {
      useClient({
        sites: { data: siteDetailRow(), error: null },
        hazard_reports: { data: hazardRows(SITE_DETAIL_HAZARD_LIMIT), error: null },
      });

      const result = await getSiteWithHazards("site-1");

      expect(result.truncated).toBe(true);
      expect(result.hazards).toHaveLength(SITE_DETAIL_HAZARD_LIMIT);
      expect(console.warn).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string);
      expect(logged).toMatchObject({
        level: "warn",
        scope: "sites",
        event: "sites.detail_truncated",
        siteId: "site-1",
        hazardCount: SITE_DETAIL_HAZARD_LIMIT,
        hazardLimit: SITE_DETAIL_HAZARD_LIMIT,
      });
    });
  });

  describe("result shape", () => {
    it("returns the normalized site, its hazards, and truncated: false on the happy path", async () => {
      useClient({
        sites: { data: siteDetailRow(), error: null },
        hazard_reports: { data: [hazardRow()], error: null },
      });

      const result = await getSiteWithHazards("site-1");

      expect(result.error).toBeNull();
      expect(result.truncated).toBe(false);
      expect(result.site).toMatchObject({ id: "site-1", name: "Alpha Cove", site_type: "unclassified" });
      expect(result.hazards).toEqual([hazardRow()]);
    });

    it("coerces PostgREST numeric-as-string coordinates to real numbers", async () => {
      useClient({
        sites: { data: siteDetailRow({ latitude: "26.7753", longitude: "-80.0431" }), error: null },
      });

      const result = await getSiteWithHazards("site-1");

      expect(result.site?.latitude).toBe(26.7753);
      expect(result.site?.longitude).toBe(-80.0431);
    });

    it("returns the shore-access explanation fields the detail page renders, coerced from numeric-as-string", async () => {
      useClient({
        sites: {
          data: siteDetailRow({
            shore_access: "marginal",
            shore_entry_id: "south-beach-5th-st",
            shore_distance_yards: "295.0",
            depth_min_ft: "20",
            depth_max_ft: "20",
          }),
          error: null,
        },
      });

      const result = await getSiteWithHazards("site-1");

      // This is the "295 yd from the 5th Street beach entry" line — the whole
      // reason the entry id and distance are persisted rather than recomputed.
      expect(result.site).toMatchObject({
        shore_access: "marginal",
        shore_entry_id: "south-beach-5th-st",
        shore_distance_yards: 295,
        depth_min_ft: 20,
        depth_max_ft: 20,
      });
    });

    it("normalizes an unclassified site's dive metadata to explicit nulls, never to 0 or a guessed level", async () => {
      useClient({ sites: { data: siteDetailRow(), error: null } });

      const result = await getSiteWithHazards("site-1");

      expect(result.site).toMatchObject({
        depth_min_ft: null,
        depth_max_ft: null,
        shore_access: null,
        shore_entry_id: null,
        shore_distance_yards: null,
      });
    });

    it("distinguishes 'no such site' (site: null, error: null) from a failure", async () => {
      useClient({ sites: { data: null, error: null } });

      const result = await getSiteWithHazards("missing");

      expect(result).toEqual({ site: null, hazards: [], truncated: false, error: null });
    });
  });

  describe("error paths", () => {
    it("returns { site: null, hazards: [], error }, never throws, when the site read fails", async () => {
      useClient({ sites: { data: null, error: postgrestError("column sites.site_type does not exist") } });

      const result = await getSiteWithHazards("site-1");

      expect(result).toEqual({
        site: null,
        hazards: [],
        truncated: false,
        error: "column sites.site_type does not exist",
      });
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("returns { site: null, hazards: [], error }, never throws, when the hazard read fails", async () => {
      useClient({
        sites: { data: siteDetailRow(), error: null },
        hazard_reports: { data: null, error: postgrestError("permission denied") },
      });

      const result = await getSiteWithHazards("site-1");

      expect(result).toEqual({ site: null, hazards: [], truncated: false, error: "permission denied" });
    });

    it("returns { site: null, hazards: [], error }, never throws, when createClient itself throws", async () => {
      mockCreateClient.mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));

      const result = await getSiteWithHazards("site-1");

      expect(result).toEqual({
        site: null,
        hazards: [],
        truncated: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_URL",
      });
    });
  });
});
