/**
 * On-demand OpenStreetMap/Overpass import pipeline (Task 21, T21.2).
 * plan.md v5 Resolved Decision #6 picks OSM/Overpass as the answer to
 * `sites` having only 3 founder-seeded rows and no insert path for anyone
 * — see `supabase/sources/dive-site-data-source-options.md` for the full
 * survey and `supabase/README.md`'s "External dive-site sourcing" section
 * for the schema half (`0008_sites_external_source.sql`).
 *
 * Two exported functions, called by `src/app/api/sites/search-nearby/route.ts`
 * (T21.3) — their signatures are pre-agreed in `plan.md`/`TASKS.md` so the
 * search-route agent can build against them without waiting on this file:
 *
 *   queryOverpassNearby({ latitude, longitude, radiusMiles })
 *     -> { sites: OsmDiveSite[]; error: string | null }
 *   upsertSitesFromOsm(osmSites: OsmDiveSite[])
 *     -> { inserted: number; skipped: number; error: string | null }
 *
 * Both wrap every I/O boundary in try/catch and never throw, per CLAUDE.md's
 * engineering standard ("wrap every I/O boundary... network failures are an
 * expected code path") — a bad Overpass response or a Supabase hiccup must
 * degrade to an explicit `error` field, never crash the caller.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import { classifyShoreAccess } from "./shore-access";
import { usesCoastalDistanceModel } from "./water-access";
import type { SiteProvenance, SiteType } from "./types";
import type { ShoreAccessConfidence, ShoreAccessMethod } from "./shore-access";

export interface OsmDiveSite {
  osmId: string;
  name: string | null;
  latitude: number;
  longitude: number;
  entryType: "shore" | "boat" | "unknown";
  siteType: SiteType;
  /** Real free-text `description` tag from the OSM node, when present —
   * e.g. "The old shipwreck known as the Delray Wreck rests at the bottom
   * of the ocean in 25 feet of water about 150 yards offshore..." Genuine,
   * human-written source content, not metadata — folded into the site's
   * stored `description` (2026-08-09, per the founder's "include all
   * data" direction) rather than discarded in favor of only the generic
   * attribution sentence, which is what this pipeline did before. */
  osmDescription: string | null;
  /** Raw `depth`/`max_depth`-style tag, when present, as OSM stores it —
   * a free-text value (e.g. "25 ft", "12m"), not parsed/normalized. */
  depth: string | null;
  /** Real `website` tag, when present — a source citation, not just an
   * OSM-attribution boilerplate link. */
  website: string | null;
}

// ---------------------------------------------------------------------
// queryOverpassNearby
// ---------------------------------------------------------------------

// overpass-api.de's public instance — free, no API key, real documented
// fair-use policy (see supabase/sources/dive-site-data-source-options.md's
// OSM section). This is why the search route (T21.3) gates calls into this
// function behind a ~30-day-per-area cache (src/lib/sites/external-search-cache.ts)
// rather than calling it on every request — that gate lives in the route,
// not here, so this function stays a plain "run one Overpass query" primitive.
const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// A slow/hung Overpass response must never hang the search route (T21.3's
// explicit requirement) — abort and degrade after this long.
const FETCH_TIMEOUT_MS = 8000;

const MILES_TO_METERS = 1609.34;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * `scuba_diving:entry` -> `OsmDiveSite.entryType`. Real-world OSM tagging
 * for this key uses `shore`/`boat`/`pier` (see the sourcing doc) plus, most
 * commonly — confirmed live, not just theorized, see `upsertSitesFromOsm`'s
 * own doc comment — no value at all. Only `shore` and `boat` are named in
 * Task 21's spec; anything else (missing, `pier`, or an unrecognized value)
 * is `"unknown"` rather than guessed. `upsertSitesFromOsm` imports `"shore"`
 * and `"unknown"`, skipping only confirmed `"boat"` — under-classifying here
 * still matters even with that widened import filter, since it's what lets
 * a genuinely `"boat"`-tagged node be excluded with confidence rather than
 * guessed at.
 */
function deriveEntryType(tags: Record<string, string> | undefined): OsmDiveSite["entryType"] {
  const entry = tags?.["scuba_diving:entry"];
  if (entry === "shore") return "shore";
  if (entry === "boat") return "boat";
  return "unknown";
}

/**
 * Derives `OsmDiveSite.siteType` (T21.5, plan.md Resolved Decision #7)
 * from a node's raw OSM tags. Every mapping below was checked against a
 * live Overpass query against overpass-api.de's own mirror during this
 * pass, not assumed from the tag name alone — see
 * `0010_sites_site_type.sql`'s header comment for the same summary at the
 * schema layer:
 *
 * - `historic=wreck` -> `shipwreck` — confirmed live in Florida (USS
 *   Vandenberg, USS Spiegel Grove, several named/unnamed FL Keys wrecks,
 *   all also `sport=scuba_diving`).
 * - `natural=cave_entrance` -> `cave` — confirmed live (Devil's Den, FL).
 *   Checked *before* `natural=spring` below: Devil's Den is colloquially
 *   a "prehistoric spring" but is tagged `cave_entrance`, not `spring`,
 *   on OSM itself — deriving from the actual tag (not the venue's common
 *   name) is what keeps this "don't guess a type the source doesn't
 *   support" rather than pattern-matching on descriptions.
 * - `natural=spring` -> `spring` — confirmed live, Florida-specific
 *   (Ginnie Spring, Ichetucknee Spring, Rainbow Spring, Rainbow Spring
 *   North — all also `sport=scuba_diving`), matching the "16 freshwater
 *   springs" finding in `supabase/sources/dive-site-data-source-options.md`
 *   section 1, which flagged the specific tag as still unverified at the
 *   time — this is that verification.
 * - `natural=reef` -> `shore_reef` — a real, documented, actively-used OSM
 *   tag (confirmed live in the wider Caribbean/Gulf region), matching
 *   plan.md Resolved Decision #7's mapping.
 * - `artificial_reef` has deliberately **no case here**. `man_made=reef`
 *   is a real, live OSM tag elsewhere (e.g. Windara Shellfish Restoration
 *   Reef, Australia; Virginia Dept. of Wildlife Resources' Christmas
 *   Tree/Tire Reefs), but a global Overpass query for
 *   `sport=scuba_diving` nodes carrying `man_made=reef` or any
 *   `artificial=*` tag returned zero results — nothing in OSM's actual
 *   scuba-diving-tagged data distinguishes an artificial reef from a
 *   natural one today. Per this task's own instruction not to invent a
 *   shaky heuristic, `artificial_reef` is reachable only through
 *   manual/founder curation for now, never derived here.
 * - Anything else (no matching tag, or a `natural=reef` that also happens
 *   to carry `historic=wreck`, etc.) -> `unclassified` — the same
 *   "under-classify rather than guess" discipline `deriveEntryType`
 *   above already uses for `entryType`.
 */
function deriveSiteType(tags: Record<string, string> | undefined): SiteType {
  if (tags?.historic === "wreck") return "shipwreck";
  if (tags?.natural === "cave_entrance") return "cave";
  if (tags?.natural === "spring") return "spring";
  if (tags?.natural === "reef") return "shore_reef";
  return "unclassified";
}

function isUsableNode(el: OverpassElement): el is OverpassElement & { id: number; lat: number; lon: number } {
  return (
    el.type === "node" &&
    typeof el.id === "number" &&
    typeof el.lat === "number" &&
    typeof el.lon === "number" &&
    el.tags?.sport === "scuba_diving"
  );
}

/** OSM has no single standardized depth key — `depth` and `max_depth` both
 * appear in real-world scuba_diving-tagged data; check both, preferring
 * whichever is actually present rather than picking one arbitrarily. */
function extractDepth(tags: Record<string, string> | undefined): string | null {
  const value = tags?.depth?.trim() || tags?.max_depth?.trim();
  return value || null;
}

function normalizeElement(el: OverpassElement & { id: number; lat: number; lon: number }): OsmDiveSite {
  return {
    osmId: String(el.id),
    name: el.tags?.name?.trim() || null,
    latitude: el.lat,
    longitude: el.lon,
    entryType: deriveEntryType(el.tags),
    siteType: deriveSiteType(el.tags),
    osmDescription: el.tags?.description?.trim() || null,
    depth: extractDepth(el.tags),
    website: el.tags?.website?.trim() || null,
  };
}

/**
 * Queries Overpass for `sport=scuba_diving` nodes within `radiusMiles` of
 * `(latitude, longitude)`. Never throws — a network failure, a timeout, or
 * a non-2xx response all resolve to `{ sites: [], error: <message> }`, per
 * this codebase's I/O-boundary standard. Callers (T21.3's search route)
 * must treat a non-null `error` here as "the external lookup didn't happen
 * this time," never as a reason to fail the whole request — local `sites`
 * data is always the fallback.
 */
export async function queryOverpassNearby(params: {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}): Promise<{ sites: OsmDiveSite[]; error: string | null }> {
  const { latitude, longitude, radiusMiles } = params;
  const radiusMeters = Math.round(radiusMiles * MILES_TO_METERS);

  // Overpass QL: every scuba_diving-tagged node within `around:<meters>` of
  // the point. `out body` returns tags (needed for scuba_diving:entry/name)
  // as well as the node's own lat/lon.
  const query = `[out:json][timeout:25];\nnode["sport"="scuba_diving"](around:${radiusMeters},${latitude},${longitude});\nout body;`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Root-caused live 2026-08-09: every "406 Not Acceptable" this
        // session (initially misread as rate-limiting/IP-blocking, since
        // curl to the identical endpoint with the identical query kept
        // succeeding) turned out to be Apache's front-end in front of
        // Overpass rejecting requests with no/a generic User-Agent —
        // confirmed by isolating a plain Node `fetch()` call with no other
        // change, which 406'd until a UA header was added, then succeeded.
        // This isn't a workaround for a quirk — Overpass's own usage
        // policy asks callers to identify their application via UA, so
        // this is both the fix and the correct etiquette.
        "User-Agent": "ShoreDive/1.0 (shore-dive-app; on-demand dive-site sourcing, Task 21)",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = `Overpass API returned ${response.status}`;
      logger.warn("osm_import.overpass_non_ok_response", {
        status: response.status,
        latitude,
        longitude,
        radiusMiles,
      });
      return { sites: [], error: message };
    }

    const payload = (await response.json()) as OverpassResponse;
    const sites = (payload.elements ?? []).filter(isUsableNode).map(normalizeElement);

    logger.info("osm_import.overpass_query_succeeded", {
      latitude,
      longitude,
      radiusMiles,
      resultCount: sites.length,
    });

    return { sites, error: null };
  } catch (error) {
    // Covers network failures, JSON-parse failures, and the AbortController
    // timeout above (surfaces as a DOMException "AbortError").
    const message = errorMessage(error);
    logger.error("osm_import.overpass_query_failed", {
      latitude,
      longitude,
      radiusMiles,
      error: message,
    });
    return { sites: [], error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------
// upsertSitesFromOsm
// ---------------------------------------------------------------------

const IMPORT_PROVENANCE: SiteProvenance = "COMMUNITY";
const EXTERNAL_SOURCE = "osm";

/**
 * `sites.description` for an OSM-imported row. Required for ODbL
 * attribution (plan.md Resolved Decision #6) — worded so a diver reading
 * the site detail page understands this is unreviewed, sourced data, not
 * just a raw tag dump.
 *
 * **Widened 2026-08-09 (founder: "this should include all data") to lead
 * with the source's own real free-text `description` tag when one exists**
 * — e.g. real, specific, human-written content like "The old shipwreck
 * known as the Delray Wreck rests at the bottom of the ocean in 25 feet of
 * water about 150 yards offshore..." (confirmed live on real Florida
 * nodes, not hypothetical). The previous version discarded this and wrote
 * only the generic attribution sentence — a real loss of the most useful
 * content OSM actually had. Depth and a source website, when present, are
 * appended as their own lines rather than merged into prose, so they stay
 * scannable and aren't confused with the (unverified) descriptive text
 * above them. The attribution/disclosure sentence is never dropped,
 * regardless of what else is available — it's the ODbL-required part.
 */
function buildOsmDescription(site: OsmDiveSite): string {
  const nameNote = site.name
    ? `Sourced under the OpenStreetMap name "${site.name}".`
    : "The source OpenStreetMap entry had no name recorded.";
  const attribution =
    "Automatically imported from OpenStreetMap community map data " +
    "(© OpenStreetMap contributors, licensed ODbL). This entry has not " +
    "been reviewed by a human — details may be incomplete or inaccurate. " +
    `${nameNote} Verify conditions independently before diving here.`;

  const lines = [site.osmDescription, attribution];
  if (site.depth) lines.push(`Reported depth: ${site.depth}.`);
  if (site.website) lines.push(`Source: ${site.website}`);

  return lines.filter(Boolean).join("\n\n");
}

interface InsertableSiteRow {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  provenance: SiteProvenance;
  legal_access_status: null;
  site_type: SiteType;
  external_source: string;
  external_id: string;
  shore_access: ShoreAccessConfidence | null;
  shore_access_method: ShoreAccessMethod | null;
  shore_entry_id: string | null;
  shore_distance_yards: number | null;
}

/**
 * Classifies a freshly-imported site's shore access at insert time, using
 * whatever OSM's own `scuba_diving:entry` tag says (`site.entryType`) as a
 * global fallback once `classifyShoreAccess`'s curated-entry model has had
 * its say — see that function's own doc comment for the full precedence
 * rules (a cited exception always wins; a curated entry always outranks an
 * unverified tag). Found 2026-08-10: this pipeline never populated
 * `shore_access` at all before this, for any site, including Florida — not
 * just a gap in global coverage.
 *
 * Gated on `usesCoastalDistanceModel(site.siteType)`, reusing
 * `water-access.ts`'s existing exemption rather than re-deriving it — the
 * coastal-distance model (and, by extension, the OSM-tag fallback that
 * only makes sense in that same "distance to open water" frame) is
 * nonsensical for a walk-in freshwater spring/cave, exactly the bug
 * `site-dive-profile.tsx` was fixed for on the render side (2026-08-10,
 * commit 4bb0990). Springs/caves stay fully unclassified here — never
 * `unlikely`, which would read as "assessed and rejected" rather than "this
 * model doesn't apply."
 */
function classifyOsmSiteShoreAccess(site: OsmDiveSite): {
  access: ShoreAccessConfidence | null;
  method: ShoreAccessMethod | null;
  entryId: string | null;
  yards: number | null;
} {
  if (!usesCoastalDistanceModel(site.siteType)) {
    return { access: null, method: null, entryId: null, yards: null };
  }

  const result = classifyShoreAccess(
    { latitude: site.latitude, longitude: site.longitude },
    undefined,
    { osmEntryTag: site.entryType },
  );

  return {
    access: result.confidence,
    method: result.method,
    entryId: result.nearestEntry?.id ?? null,
    // classifyShoreAccess returns miles; this column is yards, same
    // conversion 0012_sites_dive_metadata.sql's own comment specifies for
    // any writer of shore_distance_yards.
    yards: result.distanceMiles != null ? Math.round(result.distanceMiles * 1760 * 10) / 10 : null,
  };
}

function toInsertableRow(site: OsmDiveSite): InsertableSiteRow {
  const shore = classifyOsmSiteShoreAccess(site);

  return {
    name: site.name?.trim() || "Unnamed shore dive site (OpenStreetMap import)",
    description: buildOsmDescription(site),
    latitude: site.latitude,
    longitude: site.longitude,
    // Never VERIFIED — this is unmoderated automated ingestion, matching
    // the "no unmoderated write path to VERIFIED" standard enforced
    // elsewhere in this schema (0002_rls.sql's `with check (provenance =
    // 'COMMUNITY')` policies).
    provenance: IMPORT_PROVENANCE,
    // OSM doesn't reliably carry Florida legal/access status — never
    // guess "open"; null means "not yet assessed", same as every
    // human-submitted site with no known restriction.
    legal_access_status: null,
    // Derived by deriveSiteType() above from real OSM tags at query time
    // and carried straight through — never re-derived or defaulted here,
    // so this insert path can't silently diverge from the mapping logic
    // (and its live-verified research) documented on that function.
    site_type: site.siteType,
    external_source: EXTERNAL_SOURCE,
    external_id: site.osmId,
    shore_access: shore.access,
    shore_access_method: shore.method,
    shore_entry_id: shore.entryId,
    shore_distance_yards: shore.yards,
  };
}

/**
 * Inserts `toInsert` one row at a time, tolerating a unique_violation
 * (Postgres code 23505) on any individual row as "already imported" rather
 * than a hard failure. Only used as a fallback when the batch insert below
 * hits a race (something else imported one of these nodes between our
 * pre-check query and this insert) — see that call site's comment.
 */
async function insertRowsIndividually(
  admin: ReturnType<typeof createAdminClient>,
  rows: InsertableSiteRow[],
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const { error } = await admin.from("sites").insert(row);
    if (error) {
      if (error.code === "23505") {
        skipped += 1;
        continue;
      }
      // A real, non-duplicate error partway through the fallback loop —
      // report what happened so far rather than losing the whole batch's
      // progress, but surface it as an error so the caller/logs show
      // something genuinely went wrong (not just a race).
      logger.error("osm_import.individual_insert_failed", {
        externalId: row.external_id,
        message: error.message,
        code: error.code,
      });
      return { inserted, skipped, error: error.message };
    }
    inserted += 1;
  }

  return { inserted, skipped, error: null };
}

/**
 * Imports `osmSites` into `sites` via the service-role client. Rows with
 * `entryType === "boat"` (explicitly confirmed boat-only) are skipped
 * (counted in `skipped`, never an error) — everything else (`"shore"` and
 * `"unknown"`) is imported.
 *
 * **Widened from "shore only" to "not confirmed boat-only," 2026-08-09,
 * after a real live search found this being too strict in practice, not
 * just in theory:** a live Fort Lauderdale search returned two genuine
 * Florida shipwrecks (S.S. Inchulva/Delray Wreck, SS Copenhagen) that
 * `deriveEntryType` correctly classified `"unknown"` — neither carries a
 * `scuba_diving:entry` tag at all, which turns out to be the OSM-wide norm,
 * not an edge case: most real `sport=scuba_diving` nodes never set this
 * sub-tag, "shore"-only importing meant the pipeline imported essentially
 * nothing anywhere it was actually tried. Importing `"unknown"` rows risks
 * occasionally including a genuinely boat-only site with no entry tag —
 * accepted, because every imported row already lands as `COMMUNITY`
 * provenance (never `VERIFIED`) with an explicit "unreviewed... verify
 * conditions independently before diving here" description
 * (`buildOsmDescription`) — the same disclosed-uncertainty posture this
 * app already takes for every other unmoderated community submission, not
 * a new risk category. A human can still correct/remove a wrongly-imported
 * boat-only entry later; the old behavior of importing nothing at all was
 * a worse outcome than that manageable risk.
 *
 * Duplicate prevention: this pre-checks which of the candidate
 * `external_id`s already exist, rather than relying on
 * `.upsert(..., { onConflict })` — the unique index this depends on
 * (`sites_external_source_id_idx`, `0008_sites_external_source.sql`) is a
 * *partial* index (`where external_source is not null and external_id is
 * not null`), and Supabase/PostgREST's upsert() helper generates a plain
 * `ON CONFLICT (col1, col2)` clause with no way to supply the index's WHERE
 * predicate — Postgres requires that predicate on the ON CONFLICT target
 * to infer a partial index as the arbiter, so upsert() against this index
 * would fail at runtime with "no unique or exclusion constraint matching
 * the ON CONFLICT specification". The pre-check-then-insert flow below
 * sidesteps that entirely; a race that slips past the pre-check (two
 * concurrent imports of the same node) is caught as a unique_violation and
 * handled gracefully via `insertRowsIndividually`, never thrown.
 */
export async function upsertSitesFromOsm(
  osmSites: OsmDiveSite[],
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  // Not confirmed boat-only: imports "shore" and "unknown" entryType, skips
  // only "boat" — see this function's own doc comment for why this was
  // widened from "shore only" the same day it was first live-tested.
  const importableSites = osmSites.filter((site) => site.entryType !== "boat");
  let skipped = osmSites.length - importableSites.length;

  if (importableSites.length === 0) {
    return { inserted: 0, skipped, error: null };
  }

  try {
    const admin = createAdminClient();

    const candidateIds = importableSites.map((site) => site.osmId);
    const { data: existingRows, error: existingError } = await admin
      .from("sites")
      .select("external_id")
      .eq("external_source", EXTERNAL_SOURCE)
      .in("external_id", candidateIds);

    if (existingError) throw existingError;

    const existingIds = new Set((existingRows ?? []).map((row: { external_id: string }) => row.external_id));
    const toInsert = importableSites.filter((site) => !existingIds.has(site.osmId));
    skipped += importableSites.length - toInsert.length;

    if (toInsert.length === 0) {
      logger.info("osm_import.upsert_complete", { attempted: importableSites.length, inserted: 0, skipped });
      return { inserted: 0, skipped, error: null };
    }

    const rows = toInsert.map(toInsertableRow);
    const { data, error } = await admin.from("sites").insert(rows).select("id");

    if (error) {
      if (error.code === "23505") {
        // Race: something imported one of these nodes between the
        // pre-check above and this insert. A single INSERT with multiple
        // VALUES rows is one statement — one conflicting row fails the
        // whole batch, not just that row — so fall back to inserting one
        // at a time rather than dropping every row in this batch.
        logger.warn("osm_import.batch_insert_conflict_falling_back", { attempted: rows.length });
        const fallback = await insertRowsIndividually(admin, rows);
        const totalSkipped = skipped + fallback.skipped;
        if (fallback.error) {
          return { inserted: fallback.inserted, skipped: totalSkipped, error: fallback.error };
        }
        logger.info("osm_import.upsert_complete", {
          attempted: importableSites.length,
          inserted: fallback.inserted,
          skipped: totalSkipped,
        });
        return { inserted: fallback.inserted, skipped: totalSkipped, error: null };
      }
      throw error;
    }

    const inserted = data?.length ?? rows.length;
    logger.info("osm_import.upsert_complete", { attempted: importableSites.length, inserted, skipped });
    return { inserted, skipped, error: null };
  } catch (error) {
    // Covers createAdminClient() throwing (no live Supabase project/service-
    // role key configured yet) as well as any unexpected Supabase error.
    const message = errorMessage(error);
    logger.error("osm_import.upsert_failed", { error: message, attempted: importableSites.length });
    return { inserted: 0, skipped, error: message };
  }
}
