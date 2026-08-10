import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import type {
  HazardReport,
  Site,
  SiteMarker,
  SiteProvenance,
  LegalAccessStatus,
  ShoreAccessConfidence,
  SiteType,
} from "./types";

/**
 * Real `sites`/`hazard_reports` reads (Task 11.5) — the first application
 * code anywhere that actually queries these tables; `src/app/page.tsx`
 * previously rendered only mock/LDS data. Both tables are public-read (see
 * `supabase/migrations/0002_rls.sql`), so these never require a signed-in
 * session — the anon-key server client is enough.
 *
 * Every exported function wraps its Supabase calls in try/catch and returns
 * an explicit `error` field rather than throwing, per CLAUDE.md's engineering
 * standard ("wrap every I/O boundary... network failures are an expected
 * code path"). Callers (Server Components) render a real error/empty state
 * instead of crashing the page — same shape
 * `src/app/moderation/camera-sources/page.tsx`'s `loadError` already uses.
 */

// PostgREST can serialize Postgres `numeric` columns as JSON strings (to
// avoid float precision loss) rather than JSON numbers — the exact
// behavior depends on the project's PostgREST version/config, so this
// codebase doesn't assume either way. Every site row that ever reaches a
// caller has already been routed through this so latitude/longitude are
// always a real `number` by the time `Site`/`SiteMarker` types are used —
// callers (react-map-gl's <Marker>, in particular) need real numbers, not
// numeric strings.
function toNumber(value: number | string): number {
  return typeof value === "string" ? Number(value) : value;
}

/**
 * The nullable counterpart of `toNumber`, for the `numeric` columns added by
 * `0012_sites_dive_metadata.sql` (`depth_min_ft`, `depth_max_ft`,
 * `shore_distance_yards`). Same PostgREST numeric-as-string problem as
 * latitude/longitude, plus a null that means something.
 *
 * **`null` is preserved, and anything unparseable becomes `null` too** —
 * that direction is deliberate on a safety-adjacent field. `null` is the
 * "depth not recorded" state `classifyDiveSuitability()` is written to
 * report honestly; a `NaN` leaking through instead would sail past every
 * comparison in that function (`NaN > 130` is `false`) and produce a
 * confident-sounding "within recreational limits" summary full of `NaN` for
 * a site whose depth is in fact unknown. Degrading to "not recorded" is the
 * only honest failure here.
 */
function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // An empty/whitespace-only string is treated as absent, not as a number.
  // `Number("")` is `0`, so without this an empty depth field would arrive as
  // a literal "0 ft" claim — the single worst wrong answer this helper could
  // produce, since 0 reads as a real, extremely shallow depth rather than as
  // missing data. Caught by a test, not by review.
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface RawSiteRow {
  id: string;
  name: string;
  description: string | null;
  latitude: number | string;
  longitude: number | string;
  provenance: SiteProvenance;
  legal_access_status: LegalAccessStatus;
  site_type: SiteType;
  // `numeric` columns, so `string` is a real possibility off the wire (see
  // `toNullableNumber`); `undefined` covers a row read before
  // `0012_sites_dive_metadata.sql` has been applied to the project, which is
  // the current state of every environment — see supabase/README.md Open
  // item #15.
  depth_min_ft?: number | string | null;
  depth_max_ft?: number | string | null;
  shore_access?: ShoreAccessConfidence | null;
  shore_entry_id?: string | null;
  shore_distance_yards?: number | string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RawSiteMarkerRow {
  id: string;
  name: string;
  latitude: number | string;
  longitude: number | string;
  provenance: SiteProvenance;
  legal_access_status: LegalAccessStatus;
  site_type: SiteType;
  depth_min_ft?: number | string | null;
  depth_max_ft?: number | string | null;
  shore_access?: ShoreAccessConfidence | null;
}

/** The exact `sites` column list every map-pin query selects. One constant so
 * `listSitesWithHazardFlag` and `listSitesInBounds` can never drift apart and
 * hand `SiteMarker` a column the other one forgot.
 *
 * Kept deliberately narrow — this list is fetched for *every pin in the
 * viewport*, so a column earns a place here only if the map itself needs it
 * to place, colour or filter a pin. `depth_min_ft`/`depth_max_ft` and
 * `shore_access` (`0012_sites_dive_metadata.sql`) qualify: certification-level
 * and shore-access filtering are map-level operations, and doing either
 * without the value per pin would mean fetching detail rows just to decide
 * what to draw. `shore_entry_id`/`shore_distance_yards` do not — they are the
 * one-line explanation for a single opened site, and live in
 * `SITE_DETAIL_COLUMNS` only. */
const SITE_MARKER_COLUMNS =
  "id, name, latitude, longitude, provenance, legal_access_status, site_type, depth_min_ft, depth_max_ft, shore_access";

/**
 * The full `sites` column list for the site-detail read (T21.16) — every
 * field of `RawSiteRow`/`Site` in `./types.ts`, and nothing else.
 *
 * **This replaced a `select("*")`, and that mattered more than it looks.**
 * `listSitesWithHazardFlag()` failed loudly and immediately when `sites`
 * gained `site_type` before the code knew about it, because it names its
 * columns; `getSiteWithHazards()` silently survived the exact same
 * schema/code mismatch, because `*` returns whatever columns happen to exist
 * and TypeScript's `RawSiteRow` cast is erased at runtime. A read that can't
 * tell "the schema changed" from "everything is fine" is a bad property for
 * the query backing a page divers read hazard information off, so both reads
 * in that function now name their columns.
 *
 * Deliberately excludes `external_source`/`external_id`
 * (`0008_sites_external_source.sql`) — real columns, but import-provenance
 * bookkeeping that isn't on the `Site` type and isn't rendered anywhere. Keep
 * this list and `Site`/`RawSiteRow` in lockstep: adding a field to one
 * without the other is exactly the drift the explicit list exists to make
 * visible.
 */
const SITE_DETAIL_COLUMNS =
  "id, name, description, latitude, longitude, provenance, legal_access_status, site_type, " +
  "depth_min_ft, depth_max_ft, shore_access, shore_entry_id, shore_distance_yards, " +
  "created_by, created_at, updated_at";

/** The full `hazard_reports` column list — every field of `HazardReport` in
 * `./types.ts`, and nothing else. Same reasoning as `SITE_DETAIL_COLUMNS`;
 * note the other two hazard reads in this file select only `site_id`,
 * because they only derive a boolean flag. This one renders real rows. */
const HAZARD_REPORT_COLUMNS = "id, site_id, provenance, description, reported_by, created_at, updated_at";

/**
 * Row-count ceilings (T21.12). **These exist for correctness, not just
 * performance.** PostgREST enforces its own server-side maximum row count
 * (Supabase's default is 1000) and applies it *silently* — a query that
 * exceeds it returns a truncated array with no error and no signal. Before
 * this, both queries below selected entire tables with no `.limit()`, so the
 * moment `sites` outgrew that ceiling (Task 21's OSM import pipeline is
 * designed to grow it continuously) dive sites would have started vanishing
 * from the map with nothing indicating data had been dropped. In an app that
 * surfaces hazard information, silently dropping rows is a safety problem,
 * not a performance nit.
 *
 * The fix is two-part, and the second part matters as much as the first:
 * ask for an explicit, known number of rows, *and* report back when the
 * result hit that number, so a caller can never present a truncated list as
 * if it were complete (`ListSitesResult.truncated`).
 *
 * Values are deliberately at or under PostgREST's own 1000-row default —
 * a limit above it would be a lie, silently re-imposed by the server.
 */
/** Default page size for a bounded (map-viewport) site query. */
export const DEFAULT_SITE_QUERY_LIMIT = 500;
/** Hard ceiling on any caller-supplied `limit`; matches PostgREST's default `max-rows`. */
export const MAX_SITE_QUERY_LIMIT = 1000;
/** Ceiling on the `hazard_reports` companion read that derives `hasHazardReport`. */
export const HAZARD_FLAG_QUERY_LIMIT = 1000;

/**
 * Ceiling on the single-site hazard-report read backing the site detail page
 * (T21.16). A deliberately *smaller* sibling of `HAZARD_FLAG_QUERY_LIMIT`
 * rather than a reuse of it, for two reasons specific to this read:
 *
 * 1. **It selects whole rows, not just `site_id`.** The flag reads pull one
 *    uuid per row; this one pulls prose (`description`) for every report, all
 *    of it serialized into a Server Component payload. 1000 full hazard rows
 *    is a meaningfully large response where 1000 uuids is not.
 * 2. **Its scope is one site.** 200 hazard reports filed against a single
 *    dive site is already far past anything plausible, so this bounds the
 *    pathological/abusive case without realistically truncating an honest
 *    one — whereas `HAZARD_FLAG_QUERY_LIMIT` has to cover *every* site's
 *    reports at once and needs the headroom.
 *
 * Still comfortably under PostgREST's own 1000-row default, so it's a real,
 * self-imposed limit rather than one the server would silently re-impose.
 *
 * The truncation direction is also chosen, not incidental: the query orders
 * `created_at` descending, so hitting this ceiling drops the *oldest*
 * reports, never the newest. On a safety surface, losing the tail of stale
 * history is the tolerable failure; losing today's report would not be. And
 * it is never silent either way — see `SiteDetailResult.truncated`.
 */
export const SITE_DETAIL_HAZARD_LIMIT = 200;

/** Clamp a caller-supplied limit into `[1, MAX_SITE_QUERY_LIMIT]`. A
 * non-finite/absent value falls back to the default rather than to
 * "unbounded" — same fail-closed discipline as
 * `src/lib/webcam-extraction/rate-cap.ts`'s env-override handling. */
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_SITE_QUERY_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SITE_QUERY_LIMIT);
}

function normalizeSite(row: RawSiteRow): Site {
  return {
    ...row,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    // Written explicitly (rather than left to the spread) so a row read from
    // a project where 0012 hasn't been applied yet lands on an explicit
    // `null` — "not recorded" — instead of an absent key that a caller might
    // read as `undefined` and treat differently.
    depth_min_ft: toNullableNumber(row.depth_min_ft),
    depth_max_ft: toNullableNumber(row.depth_max_ft),
    shore_access: row.shore_access ?? null,
    shore_entry_id: row.shore_entry_id ?? null,
    shore_distance_yards: toNullableNumber(row.shore_distance_yards),
  };
}

/** `RawSiteMarkerRow` + the derived hazard flag → `SiteMarker`. One helper so
 * `listSitesWithHazardFlag` and `listSitesInBounds` build pins identically —
 * the mapping counterpart of `SITE_MARKER_COLUMNS`, which already exists so
 * the two queries can't select different columns. Before this they held two
 * hand-maintained copies of the same object literal, i.e. exactly the drift
 * that constant was introduced to prevent, one layer down. */
function normalizeMarker(row: RawSiteMarkerRow, hasHazardReport: boolean): SiteMarker {
  return {
    id: row.id,
    name: row.name,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    provenance: row.provenance,
    legal_access_status: row.legal_access_status,
    site_type: row.site_type,
    depth_min_ft: toNullableNumber(row.depth_min_ft),
    depth_max_ft: toNullableNumber(row.depth_max_ft),
    shore_access: row.shore_access ?? null,
    hasHazardReport,
  };
}

export interface ListSitesResult {
  sites: SiteMarker[];
  /**
   * `true` when the query came back holding exactly as many rows as it asked
   * for, which means more rows may exist that this result does not contain.
   * It is a "may be incomplete" signal, not a "definitely dropped rows" one —
   * a table with exactly `limit` rows trips it too. That asymmetry is
   * deliberate: over-reporting possible incompleteness is safe, under-
   * reporting it is exactly the silent-truncation failure this flag exists to
   * make impossible.
   *
   * Callers must never render a list that has this set as if it were the
   * complete picture (CLAUDE.md: "Never let a UI imply a guarantee the system
   * can't back"). Added as a new field rather than a changed shape, so
   * existing `{ sites, error }` destructuring callers keep compiling.
   */
  truncated: boolean;
  error: string | null;
}

/**
 * Every site, reduced to the map-pin-rendering shape (Task 11.5, wiring
 * `src/components/site-map.tsx`). `hasHazardReport` is derived from a
 * second, separate `hazard_reports` query (selecting only `site_id`) rather
 * than a join/count in one round trip — both tables are small in v1 and this
 * keeps each query simple and independently cacheable; revisit with a real
 * join if `hazard_reports` grows large enough for this to matter.
 *
 * **Deliberately still unfiltered geographically** (T21.12): the homepage is
 * a Server Component and geolocation is browser-only, so there are no user
 * coordinates server-side to bound this by — a global-ish list is a real use
 * case, not an oversight. What changed is that it is now *bounded* and
 * *honest about it*: both reads carry an explicit `.limit()`, and hitting
 * either one sets `truncated`. Prefer `listSitesInBounds()` wherever real
 * coordinates or a map viewport are available.
 */
export async function listSitesWithHazardFlag(): Promise<ListSitesResult> {
  try {
    const supabase = await createClient();

    const [sitesResult, hazardsResult] = await Promise.all([
      supabase
        .from("sites")
        .select(SITE_MARKER_COLUMNS)
        .order("name", { ascending: true })
        .limit(DEFAULT_SITE_QUERY_LIMIT)
        .returns<RawSiteMarkerRow[]>(),
      // Kept as a parallel, unscoped read (not `.in("site_id", ids)` like
      // `listSitesInBounds` does) so this stays one round trip rather than
      // two — the site ids aren't known until the first query resolves. The
      // cost is that a truncated hazard read could leave a real hazard
      // report's site rendering *without* its flag, i.e. failing toward
      // looking safer than reality — the wrong direction. That's precisely
      // why hitting this limit also sets `truncated` below, rather than being
      // quietly tolerated.
      supabase
        .from("hazard_reports")
        .select("site_id")
        .limit(HAZARD_FLAG_QUERY_LIMIT)
        .returns<{ site_id: string }[]>(),
    ]);

    if (sitesResult.error) throw sitesResult.error;
    if (hazardsResult.error) throw hazardsResult.error;

    const siteRows = sitesResult.data ?? [];
    const hazardRows = hazardsResult.data ?? [];
    const hazardSiteIds = new Set(hazardRows.map((row) => row.site_id));

    const sitesTruncated = siteRows.length >= DEFAULT_SITE_QUERY_LIMIT;
    const hazardsTruncated = hazardRows.length >= HAZARD_FLAG_QUERY_LIMIT;
    const truncated = sitesTruncated || hazardsTruncated;

    if (truncated) {
      logger.warn("sites.list_truncated", {
        siteCount: siteRows.length,
        siteLimit: DEFAULT_SITE_QUERY_LIMIT,
        hazardCount: hazardRows.length,
        hazardLimit: HAZARD_FLAG_QUERY_LIMIT,
        sitesTruncated,
        hazardsTruncated,
      });
    }

    const sites: SiteMarker[] = siteRows.map((row) => normalizeMarker(row, hazardSiteIds.has(row.id)));

    return { sites, truncated, error: null };
  } catch (error) {
    // Expected until a real Supabase project/env vars exist (P0-A.1) — fail
    // toward an empty list + visible error, never toward silently showing
    // stale/mock data as if it were real (THREAT_MODEL.md §2's "fail toward
    // looking less fresh, not more" principle, applied to "real vs. mock"
    // instead of "fresh vs. stale").
    logger.error("sites.list_failed", { error: errorMessage(error) });
    // `truncated: false` alongside a set `error`: the list is empty, not
    // partial, and the caller is already required to surface `error`.
    return { sites: [], truncated: false, error: errorMessage(error) };
  }
}

export interface ListSitesInBoundsParams {
  /** Northern latitude edge (inclusive). */
  north: number;
  /** Southern latitude edge (inclusive). */
  south: number;
  /** Eastern longitude edge (inclusive). */
  east: number;
  /** Western longitude edge (inclusive). */
  west: number;
  /** Max rows to return. Clamped to `[1, MAX_SITE_QUERY_LIMIT]`; defaults to `DEFAULT_SITE_QUERY_LIMIT`. */
  limit?: number;
}

/**
 * Sites inside a lat/lng bounding box, filtered **server-side** (T21.12) —
 * the bounded counterpart to `listSitesWithHazardFlag`. Use this anywhere
 * real coordinates or a map viewport exist; it exists so callers stop pulling
 * the whole table down and filtering by radius in JavaScript, which stops
 * working the moment the table outgrows PostgREST's silent row ceiling.
 *
 * The `hazard_reports` companion read is scoped with `.in("site_id", ...)` to
 * exactly the sites this call returned, so it is a second *bounded* read
 * rather than a second full-table one. That also makes `hasHazardReport`
 * strictly more trustworthy here than in `listSitesWithHazardFlag`: the
 * hazard rows can only be for sites already in hand.
 *
 * **Antimeridian (±180°) — handled, not documented-around.** A box that
 * crosses the antimeridian has `west > east` (e.g. west 170, east -170), and
 * cannot be expressed as `longitude >= west AND longitude <= east` — that
 * conjunction is unsatisfiable and would return zero rows, silently, for
 * every Pacific user. Detected explicitly and expressed as
 * `longitude >= west OR longitude <= east` via PostgREST's `or=(...)`, which
 * still ANDs against the latitude bounds. Latitude needs no equivalent case:
 * it doesn't wrap.
 */
export async function listSitesInBounds(params: ListSitesInBoundsParams): Promise<ListSitesResult> {
  const { north, south, east, west } = params;
  const limit = clampLimit(params.limit);

  // Validate before touching the network: a malformed box would otherwise
  // become a query returning zero rows, which is indistinguishable from
  // "genuinely no sites here" — the exact silent-wrong-answer class of bug
  // this whole function exists to remove.
  if (![north, south, east, west].every((value) => typeof value === "number" && Number.isFinite(value))) {
    const message = "Invalid bounding box: north/south/east/west must all be finite numbers.";
    logger.warn("sites.bounds_invalid", { north, south, east, west, reason: "non_finite" });
    return { sites: [], truncated: false, error: message };
  }

  if (north < south) {
    const message = `Invalid bounding box: north (${north}) is south of south (${south}).`;
    logger.warn("sites.bounds_invalid", { north, south, reason: "inverted_latitude" });
    return { sites: [], truncated: false, error: message };
  }

  try {
    const supabase = await createClient();

    const base = supabase.from("sites").select(SITE_MARKER_COLUMNS).gte("latitude", south).lte("latitude", north);

    // west > east is the antimeridian-crossing case (see the doc comment).
    const bounded = west > east
      ? base.or(`longitude.gte.${west},longitude.lte.${east}`)
      : base.gte("longitude", west).lte("longitude", east);

    const sitesResult = await bounded
      .order("name", { ascending: true })
      .limit(limit)
      .returns<RawSiteMarkerRow[]>();

    if (sitesResult.error) throw sitesResult.error;

    const siteRows = sitesResult.data ?? [];
    const sitesTruncated = siteRows.length >= limit;

    const { hazardSiteIds, truncated: hazardsTruncated } = await fetchHazardSiteIds(
      supabase,
      siteRows.map((row) => row.id),
    );

    const truncated = sitesTruncated || hazardsTruncated;
    if (truncated) {
      logger.warn("sites.bounds_truncated", {
        siteCount: siteRows.length,
        siteLimit: limit,
        hazardLimit: HAZARD_FLAG_QUERY_LIMIT,
        sitesTruncated,
        hazardsTruncated,
        north,
        south,
        east,
        west,
      });
    }

    const sites: SiteMarker[] = siteRows.map((row) => normalizeMarker(row, hazardSiteIds.has(row.id)));

    return { sites, truncated, error: null };
  } catch (error) {
    logger.error("sites.bounds_failed", {
      north,
      south,
      east,
      west,
      limit,
      error: errorMessage(error),
    });
    return { sites: [], truncated: false, error: errorMessage(error) };
  }
}

/**
 * `hazard_reports.site_id`s for a known set of sites. Throws on a Supabase
 * error so the caller's own try/catch owns the single error-shaping path —
 * this helper is internal and never called outside one.
 */
async function fetchHazardSiteIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteIds: string[],
): Promise<{ hazardSiteIds: Set<string>; truncated: boolean }> {
  // No sites means no possible hazard rows — skip the round trip entirely
  // rather than issuing an `in.()` against an empty list.
  if (siteIds.length === 0) return { hazardSiteIds: new Set(), truncated: false };

  const hazardsResult = await supabase
    .from("hazard_reports")
    .select("site_id")
    .in("site_id", siteIds)
    .limit(HAZARD_FLAG_QUERY_LIMIT)
    .returns<{ site_id: string }[]>();

  if (hazardsResult.error) throw hazardsResult.error;

  const rows = hazardsResult.data ?? [];
  return {
    hazardSiteIds: new Set(rows.map((row) => row.site_id)),
    truncated: rows.length >= HAZARD_FLAG_QUERY_LIMIT,
  };
}

export interface SiteDetailResult {
  site: Site | null;
  hazards: HazardReport[];
  /**
   * `true` when `hazards` came back holding exactly `SITE_DETAIL_HAZARD_LIMIT`
   * rows, i.e. more reports may exist for this site than this result contains.
   *
   * Same "may be incomplete, not definitely dropped" semantics as
   * `ListSitesResult.truncated`, and named the same on purpose so the two
   * results in this module read alike. It refers **only to `hazards`** — the
   * `site` read is a `maybeSingle()` and has nothing to truncate.
   *
   * Callers must not present the hazard list as this site's complete history
   * when this is set (CLAUDE.md: "Never let a UI imply a guarantee the system
   * can't back"). Added additively, so existing
   * `{ site, hazards, error }` destructuring keeps compiling — no call site
   * was changed by the pass that introduced it, the same way T21.12
   * introduced `ListSitesResult.truncated`.
   */
  truncated: boolean;
  error: string | null;
}

/**
 * A single site plus its hazard reports (Task 11.5's site detail page).
 * `site: null` with `error: null` means "no such site" (a `maybeSingle()`
 * miss, not a failure) — distinct from `error` being set, which means the
 * query itself failed. Callers must handle both cases separately.
 *
 * **Both reads name their columns** (`SITE_DETAIL_COLUMNS` /
 * `HAZARD_REPORT_COLUMNS`) rather than using `select("*")`, and the hazard
 * read is bounded by `SITE_DETAIL_HAZARD_LIMIT` (T21.16). See those constants
 * for why each matters — briefly: `*` makes a schema/code mismatch invisible
 * instead of loud, and an unbounded read is the same silent-truncation class
 * of bug T21.12 fixed in this file's other two functions, just at
 * single-site scale.
 */
export async function getSiteWithHazards(id: string): Promise<SiteDetailResult> {
  try {
    const supabase = await createClient();

    const [siteResult, hazardsResult] = await Promise.all([
      supabase.from("sites").select(SITE_DETAIL_COLUMNS).eq("id", id).maybeSingle<RawSiteRow>(),
      supabase
        .from("hazard_reports")
        .select(HAZARD_REPORT_COLUMNS)
        .eq("site_id", id)
        // Newest first, so the row this drops on truncation is always the
        // oldest one — see SITE_DETAIL_HAZARD_LIMIT. The order/limit pairing
        // is load-bearing, not cosmetic: reordering this without revisiting
        // the limit would start dropping the *newest* hazard reports.
        .order("created_at", { ascending: false })
        .limit(SITE_DETAIL_HAZARD_LIMIT)
        .returns<HazardReport[]>(),
    ]);

    if (siteResult.error) throw siteResult.error;
    if (hazardsResult.error) throw hazardsResult.error;

    const hazards = hazardsResult.data ?? [];
    const truncated = hazards.length >= SITE_DETAIL_HAZARD_LIMIT;

    if (truncated) {
      logger.warn("sites.detail_truncated", {
        siteId: id,
        hazardCount: hazards.length,
        hazardLimit: SITE_DETAIL_HAZARD_LIMIT,
      });
    }

    return {
      site: siteResult.data ? normalizeSite(siteResult.data) : null,
      hazards,
      truncated,
      error: null,
    };
  } catch (error) {
    logger.error("sites.detail_failed", { siteId: id, error: errorMessage(error) });
    // `truncated: false` alongside a set `error`: nothing was returned at
    // all, so it isn't a partial list — same convention as ListSitesResult's
    // error path.
    return { site: null, hazards: [], truncated: false, error: errorMessage(error) };
  }
}
