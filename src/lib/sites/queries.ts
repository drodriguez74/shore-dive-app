import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import { latestStatusPerShop, type LdsProvenance, type LdsStatusRow, type LdsStatusValue } from "@/components/lds/lds-status";
import type {
  HazardReport,
  ResearchSource,
  Site,
  SiteMarker,
  SiteProvenance,
  LegalAccessStatus,
  ShoreAccessConfidence,
  ShoreAccessMethod,
  SiteType,
} from "./types";

/**
 * Server-side reads of `sites`, `hazard_reports` and `lds_status`. All three
 * are public-read, so the anon-key server client is enough. Every exported
 * function catches its own errors and returns an explicit `error` field —
 * callers render an error state instead of crashing the page.
 */

// PostgREST may return `numeric` columns as JSON strings; coerce so callers
// (map markers in particular) always get real numbers.
function toNumber(value: number | string): number {
  return typeof value === "string" ? Number(value) : value;
}

/**
 * Nullable `toNumber`. Anything unparseable becomes `null` ("not recorded"),
 * never `NaN`: `NaN > 130` is false, so a NaN depth would read as "within
 * recreational limits" for a site whose depth is actually unknown.
 */
function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // `Number("")` is 0 — an empty field must not become a real "0 ft" depth.
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Narrows untyped `research_sources` jsonb; a malformed value degrades to "no sources", never a citation with a missing link. */
function toResearchSources(value: unknown): ResearchSource[] | null {
  if (!Array.isArray(value)) return null;
  const sources: ResearchSource[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).title === "string" &&
      typeof (entry as Record<string, unknown>).url === "string"
    ) {
      sources.push({ title: (entry as { title: string }).title, url: (entry as { url: string }).url });
    }
  }
  return sources.length > 0 ? sources : null;
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
  // Optional: `undefined` covers a row read from a project where the migration
  // adding the column (0012/0013/0014) hasn't been applied.
  depth_min_ft?: number | string | null;
  depth_max_ft?: number | string | null;
  shore_access?: ShoreAccessConfidence | null;
  shore_access_method?: ShoreAccessMethod | null;
  shore_entry_id?: string | null;
  shore_distance_yards?: number | string | null;
  research_summary?: string | null;
  // Untyped over the wire — narrowed by `toResearchSources`.
  research_sources?: unknown;
  research_summary_updated_at?: string | null;
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
  shore_access_method?: ShoreAccessMethod | null;
}

/**
 * The `sites` columns every map-pin query selects — one constant so the pin
 * queries can't drift apart. Kept narrow: it is fetched for every pin in
 * view, so a column belongs here only if the map needs it to place, colour
 * or filter a pin. Detail-only fields live in `SITE_DETAIL_COLUMNS`.
 */
const SITE_MARKER_COLUMNS =
  "id, name, latitude, longitude, provenance, legal_access_status, site_type, depth_min_ft, depth_max_ft, shore_access, shore_access_method";

/**
 * Every field of `Site`, named explicitly rather than `select("*")` so a
 * schema/code mismatch fails loudly instead of silently returning whatever
 * columns exist. Keep in lockstep with `Site`/`RawSiteRow`.
 */
const SITE_DETAIL_COLUMNS =
  "id, name, description, latitude, longitude, provenance, legal_access_status, site_type, " +
  "depth_min_ft, depth_max_ft, shore_access, shore_access_method, shore_entry_id, shore_distance_yards, " +
  "research_summary, research_sources, research_summary_updated_at, " +
  "created_by, created_at, updated_at";

/** Every field of `HazardReport`, named explicitly for the same reason as `SITE_DETAIL_COLUMNS`. */
const HAZARD_REPORT_COLUMNS = "id, site_id, provenance, description, reported_by, created_at, updated_at";

/**
 * Row-count ceilings. PostgREST silently truncates at its own maximum
 * (Supabase default 1000), so every read asks for an explicit number of rows
 * and reports when the result hit it (`truncated`) — on a hazard surface,
 * silently dropped rows are a safety problem. Values stay at or under 1000.
 */
/** Default page size for a bounded (map-viewport) site query. */
export const DEFAULT_SITE_QUERY_LIMIT = 500;
/** Hard ceiling on any caller-supplied `limit`; matches PostgREST's default `max-rows`. */
export const MAX_SITE_QUERY_LIMIT = 1000;
/** Ceiling on the `hazard_reports` companion read that derives `hasHazardReport`. */
export const HAZARD_FLAG_QUERY_LIMIT = 1000;

/**
 * Ceiling on the site-detail hazard read. Smaller than the flag read's limit
 * because it returns whole rows for one site. The query orders newest-first,
 * so hitting it drops the oldest reports, never today's.
 */
export const SITE_DETAIL_HAZARD_LIMIT = 200;

/** Clamps a caller-supplied limit into `[1, MAX_SITE_QUERY_LIMIT]`; anything non-finite falls back to the default, never to "unbounded". */
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_SITE_QUERY_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SITE_QUERY_LIMIT);
}

function normalizeSite(row: RawSiteRow): Site {
  return {
    ...row,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    // Explicit so a missing column lands on `null` ("not recorded"), not `undefined`.
    depth_min_ft: toNullableNumber(row.depth_min_ft),
    depth_max_ft: toNullableNumber(row.depth_max_ft),
    shore_access: row.shore_access ?? null,
    shore_access_method: row.shore_access_method ?? null,
    shore_entry_id: row.shore_entry_id ?? null,
    shore_distance_yards: toNullableNumber(row.shore_distance_yards),
    research_summary: row.research_summary ?? null,
    research_sources: toResearchSources(row.research_sources),
    research_summary_updated_at: row.research_summary_updated_at ?? null,
  };
}

/** Row + derived hazard flag → `SiteMarker`; the single mapping every pin query shares. */
function normalizeMarker(row: RawSiteMarkerRow, hasHazardReport: boolean, latestHazardReportAt: string | null): SiteMarker {
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
    shore_access_method: row.shore_access_method ?? null,
    hasHazardReport,
    latestHazardReportAt,
  };
}

export interface ListSitesResult {
  sites: SiteMarker[];
  /**
   * The query returned exactly as many rows as it asked for, so more may
   * exist. A "may be incomplete" signal — callers must never present such a
   * list as the complete picture.
   */
  truncated: boolean;
  error: string | null;
}

/**
 * Every site as a map pin, for the homepage's server render. Not filtered by
 * location (there are no user coordinates server-side) but bounded, and
 * `truncated` says when a limit was hit. Prefer `listSitesNear()` whenever a
 * real centre and radius exist.
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
      // Read in parallel (site ids aren't known yet), so it is bounded
      // separately: a truncated hazard read would hide a real hazard flag,
      // which is why hitting its limit also sets `truncated`. Newest-first, so
      // the first row per site is its latest report.
      supabase
        .from("hazard_reports")
        .select("site_id, created_at")
        .order("created_at", { ascending: false })
        .limit(HAZARD_FLAG_QUERY_LIMIT)
        .returns<{ site_id: string; created_at: string }[]>(),
    ]);

    if (sitesResult.error) throw sitesResult.error;
    if (hazardsResult.error) throw hazardsResult.error;

    const siteRows = sitesResult.data ?? [];
    const hazardRows = hazardsResult.data ?? [];
    const latestHazardBySiteId = latestHazardTimestampBySite(hazardRows);

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

    const sites: SiteMarker[] = siteRows.map((row) =>
      normalizeMarker(row, latestHazardBySiteId.has(row.id), latestHazardBySiteId.get(row.id) ?? null),
    );

    return { sites, truncated, error: null };
  } catch (error) {
    // Fail toward an empty list plus a visible error, never toward stale or mock data.
    logger.error("sites.list_failed", { error: errorMessage(error) });
    return { sites: [], truncated: false, error: errorMessage(error) };
  }
}

/** One latest timestamp per site. Requires rows ordered newest-first: the first row seen for a site is its latest. */
function latestHazardTimestampBySite(rows: { site_id: string; created_at: string }[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!latest.has(row.site_id)) latest.set(row.site_id, row.created_at);
  }
  return latest;
}

/** Latest hazard-report time per site, for a known set of sites. Throws on a query error; callers own the error shaping. */
async function fetchLatestHazardBySite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteIds: string[],
): Promise<{ latestHazardBySiteId: Map<string, string>; truncated: boolean }> {
  // No sites means no possible hazard rows — skip the round trip entirely
  // rather than issuing an `in.()` against an empty list.
  if (siteIds.length === 0) return { latestHazardBySiteId: new Map(), truncated: false };

  const hazardsResult = await supabase
    .from("hazard_reports")
    .select("site_id, created_at")
    .in("site_id", siteIds)
    // Newest first — `latestHazardTimestampBySite` depends on it.
    .order("created_at", { ascending: false })
    .limit(HAZARD_FLAG_QUERY_LIMIT)
    .returns<{ site_id: string; created_at: string }[]>();

  if (hazardsResult.error) throw hazardsResult.error;

  const rows = hazardsResult.data ?? [];
  return {
    latestHazardBySiteId: latestHazardTimestampBySite(rows),
    truncated: rows.length >= HAZARD_FLAG_QUERY_LIMIT,
  };
}

export interface ListSitesNearParams {
  latitude: number;
  longitude: number;
  /** Search radius in miles. Must be finite and > 0. */
  radiusMiles: number;
  /** Max rows to return. Clamped to `[1, MAX_SITE_QUERY_LIMIT]`; defaults to `DEFAULT_SITE_QUERY_LIMIT`. */
  limit?: number;
}

/**
 * Sites within `radiusMiles` of a point, nearest first, filtered and ordered
 * in SQL by `search_sites_near` (migration 0016) — so a row cap clips the
 * farthest sites, not an arbitrary slice. Never throws.
 */
export async function listSitesNear(params: ListSitesNearParams): Promise<ListSitesResult> {
  const { latitude, longitude, radiusMiles } = params;
  const limit = clampLimit(params.limit);

  // Validate before the round trip: a NaN/out-of-range argument reaches
  // Postgres as a zero-row query, indistinguishable from "nothing here".
  if (
    ![latitude, longitude, radiusMiles].every((value) => typeof value === "number" && Number.isFinite(value)) ||
    radiusMiles <= 0 ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    const message = "Invalid nearby search: latitude, longitude and a positive radiusMiles are required.";
    logger.warn("sites.near_invalid", { latitude, longitude, radiusMiles });
    return { sites: [], truncated: false, error: message };
  }

  try {
    const supabase = await createClient();

    const sitesResult = await supabase.rpc("search_sites_near", {
      center_lat: latitude,
      center_lng: longitude,
      radius_miles: radiusMiles,
      max_rows: limit,
    });

    if (sitesResult.error) throw sitesResult.error;

    // No generated DB types for `.rpc()`; the SQL function returns the
    // `SITE_MARKER_COLUMNS` shape (plus an ignored `distance_miles`).
    const siteRows = (sitesResult.data ?? []) as RawSiteMarkerRow[];
    const sitesTruncated = siteRows.length >= limit;

    const { latestHazardBySiteId, truncated: hazardsTruncated } = await fetchLatestHazardBySite(
      supabase,
      siteRows.map((row) => row.id),
    );

    const truncated = sitesTruncated || hazardsTruncated;
    if (truncated) {
      logger.warn("sites.near_truncated", {
        siteCount: siteRows.length,
        siteLimit: limit,
        hazardLimit: HAZARD_FLAG_QUERY_LIMIT,
        sitesTruncated,
        hazardsTruncated,
        latitude,
        longitude,
        radiusMiles,
      });
    }

    const sites: SiteMarker[] = siteRows.map((row) =>
      normalizeMarker(row, latestHazardBySiteId.has(row.id), latestHazardBySiteId.get(row.id) ?? null),
    );

    return { sites, truncated, error: null };
  } catch (error) {
    logger.error("sites.near_failed", {
      latitude,
      longitude,
      radiusMiles,
      limit,
      error: errorMessage(error),
    });
    return { sites: [], truncated: false, error: errorMessage(error) };
  }
}

export interface SiteDetailResult {
  site: Site | null;
  hazards: HazardReport[];
  /** The hazard list hit `SITE_DETAIL_HAZARD_LIMIT`, so older reports may exist — never present it as the complete history. */
  truncated: boolean;
  error: string | null;
}

/**
 * One site plus its hazard reports. `site: null` with `error: null` means
 * "no such site"; a set `error` means the query failed — callers handle the
 * two separately.
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
        // Newest first, so truncation drops the oldest report. Keep order and limit together.
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
    return { site: null, hazards: [], truncated: false, error: errorMessage(error) };
  }
}

// ---------------------------------------------------------------------
// lds_status (fill-station status)
// ---------------------------------------------------------------------

interface RawLdsStatusRow {
  id: string;
  site_id: string | null;
  name: string;
  latitude: number | string;
  longitude: number | string;
  status: LdsStatusValue;
  provenance: LdsProvenance;
  last_verified_at: string;
  created_by: string | null;
  created_at: string;
}

/** Every column `LdsStatusRow` needs. Exported so the submit route selects its inserted row back in exactly this shape. */
export const LDS_STATUS_COLUMNS =
  "id, site_id, name, latitude, longitude, status, provenance, last_verified_at, created_by, created_at";

/** Explicit row ceiling, same convention as the site reads. */
export const LDS_STATUS_QUERY_LIMIT = 1000;

export interface LdsStatusMarkersResult {
  /** One row per shop (the latest report); `lds_status` itself is an append-only log. */
  markers: LdsStatusRow[];
  truncated: boolean;
  error: string | null;
}

/**
 * Latest fill-station status per shop. An empty result is a legitimate
 * state; on a read failure this returns an empty list and an error, never
 * placeholder markers.
 */
export async function listLdsStatusMarkers(): Promise<LdsStatusMarkersResult> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("lds_status")
      .select(LDS_STATUS_COLUMNS)
      .order("last_verified_at", { ascending: false })
      .limit(LDS_STATUS_QUERY_LIMIT)
      .returns<RawLdsStatusRow[]>();

    if (error) throw error;

    const rows = data ?? [];
    const truncated = rows.length >= LDS_STATUS_QUERY_LIMIT;
    if (truncated) {
      logger.warn("lds_status.list_truncated", { count: rows.length, limit: LDS_STATUS_QUERY_LIMIT });
    }

    const normalized: LdsStatusRow[] = rows.map((row) => ({
      ...row,
      latitude: toNumber(row.latitude),
      longitude: toNumber(row.longitude),
    }));

    return { markers: latestStatusPerShop(normalized), truncated, error: null };
  } catch (error) {
    logger.error("lds_status.list_failed", { error: errorMessage(error) });
    return { markers: [], truncated: false, error: errorMessage(error) };
  }
}
