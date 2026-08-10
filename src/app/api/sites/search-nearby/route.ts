import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { listSitesInBounds } from "@/lib/sites/queries";
import { boundingBoxForRadius, sortByDistanceWithinRadius } from "@/lib/sites/distance";
import { queryOverpassNearby, upsertSitesFromOsm } from "@/lib/sites/osm-import";
import { claimExternalSearchWindow } from "@/lib/sites/external-search-cache";
import { logger } from "@/lib/sites/logger";

/**
 * On-demand nearby-sites search (Task 21, T21.3). plan.md v5 Resolved
 * Decision #6's cache-then-serve pattern: local `sites` is always queried
 * first; only when a search area is thin on local data does this route
 * fall back to an Overpass lookup (gated by a ~30-day-per-area cooldown,
 * `src/lib/sites/external-search-cache.ts`), import whatever real shore
 * sites it finds, and re-serve from local data. Imported rows persist, so
 * the next person searching the same area gets an instant local read.
 *
 * `GET /api/sites/search-nearby?lat=<n>&lng=<n>&radiusMiles=<n>`
 *
 * Follows the same NextRequest/NextResponse + try/catch + structured-logger
 * shape as `src/app/api/dive-plans/route.ts` and
 * `src/app/api/camera-sources/[id]/review/route.ts`.
 *
 * ## Who may trigger the external import (read before changing this file)
 *
 * **Reading local site data is public and must stay public** — that's the
 * whole model (`supabase/migrations/0002_rls.sql`'s public-read policies),
 * and an anonymous visitor must keep getting a working map. Only the
 * *external-import side effect* is gated, and it's gated twice:
 *
 * 1. **A signed-in user is required** to trigger an Overpass lookup. The
 *    import path writes new `sites` rows via the service-role client, which
 *    bypasses RLS entirely — so leaving it reachable anonymously made an
 *    unauthenticated GET an unbounded automated-write trigger, and abused
 *    Overpass's free public instance (a real fair-use violation that can
 *    get the deploying IP banned). An anonymous request is NOT an error:
 *    it still gets a normal 200 with local results and
 *    `searchedExternally: false`.
 * 2. **A global daily cap** on external searches
 *    (`DAILY_EXTERNAL_SEARCH_CAP` in `external-search-cache.ts`), enforced
 *    inside `claimExternalSearchWindow`, so even signed-in users can't
 *    collectively hammer Overpass. The per-grid-cell cooldown does not
 *    bound total volume on its own — see that file's header.
 *
 * ## Error-handling contract (load-bearing — read before changing this file)
 *
 * `error` in the response body is reserved for a LOCAL database failure.
 * An Overpass/import failure must never surface there and must never
 * produce a non-200 response — this route degrades to whatever local data
 * already exists rather than failing the request over an external API
 * having a bad day (Task 21's explicit requirement). `searchedExternally`
 * tells the caller whether an Overpass lookup was actually attempted this
 * request, independent of whether it succeeded or found anything.
 */

// Below this many in-radius local results, this route treats the area as
// "thin" and considers falling back to Overpass (subject to the ~30-day
// per-area cooldown in external-search-cache.ts, corrected same-day from
// an original 24h spec — see that file's header comment). plan.md/TASKS.md
// name 3 as the example threshold.
const LOCAL_RESULT_THRESHOLD = 3;

// Defensive upper bound — this route (and, if it falls through to Overpass,
// that API's own around: query) is a "nearby" search, not a full-database
// scan. Doesn't reject a large value outright (see validation below), just
// clamps it.
const MAX_RADIUS_MILES = 500;

// Row cap for this route's local read — deliberately smaller than
// `DEFAULT_SITE_QUERY_LIMIT` (500), which `listSitesInBounds` would
// otherwise default to. Found 2026-08-10, live-reproduced in both `next
// dev` and a production build (`next build && next start`), not a dev-only
// artifact: a large-radius query (390 rows succeeds, ~400+ fails) makes
// this route's own outbound Supabase fetch throw a bare "TypeError: fetch
// failed" — isolated to Next.js's server fetch handling specifically (the
// identical query succeeds instantly via a plain script using the same
// Supabase client construction, outside Next.js entirely). This reads as a
// large-response-body bug in Next's bundled fetch/undici, not anything
// wrong with the query, the data, or this app's own code — and not
// something fixable at this layer. `SEARCH_NEARBY_ROW_LIMIT` keeps this
// route's responses safely under the observed failure threshold, with real
// margin. Same "explicit, known, honestly-reported limit" discipline
// `queries.ts`'s own row-count-ceiling comment already documents — a
// diver browsing a map does not need 500 pins in one response, and
// `truncated` (already part of `ListSitesResult`) reports honestly when
// this cap is hit rather than silently dropping rows.
const SEARCH_NEARBY_ROW_LIMIT = 200;

function parseCoordinateParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function parseRadiusParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, MAX_RADIUS_MILES);
}

/**
 * Resolves the signed-in user's id, or `null` for an anonymous request.
 *
 * Same server-client auth pattern as `src/app/api/dive-plans/route.ts`
 * (`createClient` from `@/lib/supabase/server` + `auth.getUser()`), but
 * deliberately never throws and never 401s: unlike that route, "no user" is
 * a normal, supported outcome here — it just means this request doesn't get
 * to trigger an external import.
 *
 * Called only on the thin-area path, so a plain public map read pays no
 * cookie/auth round trip.
 *
 * Fails closed (returns `null`, i.e. "treat as anonymous, skip the external
 * search") if the auth check itself throws — e.g. missing Supabase env
 * vars. An unverifiable identity must never unlock a service-role write
 * path, and degrading to local-only results is always acceptable here.
 */
async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // An absent session surfaces as an error here ("Auth session missing"),
    // which is the ordinary anonymous case — not worth logging per request.
    if (error || !user) return null;
    return user.id;
  } catch (error) {
    logger.warn("search_nearby.auth_check_failed", { error: errorMessage(error) });
    return null;
  }
}

export async function GET(request: NextRequest) {
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(request.url).searchParams;
  } catch (error) {
    logger.error("search_nearby.url_parse_failed", {
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Malformed request URL." }, { status: 400 });
  }

  const lat = parseCoordinateParam(searchParams.get("lat"), -90, 90);
  const lng = parseCoordinateParam(searchParams.get("lng"), -180, 180);
  const radiusMiles = parseRadiusParam(searchParams.get("radiusMiles"));

  if (lat === null) {
    return NextResponse.json({ error: "A valid `lat` between -90 and 90 is required." }, { status: 400 });
  }
  if (lng === null) {
    return NextResponse.json({ error: "A valid `lng` between -180 and 180 is required." }, { status: 400 });
  }
  if (radiusMiles === null) {
    return NextResponse.json({ error: "A valid, positive `radiusMiles` is required." }, { status: 400 });
  }

  const center = { latitude: lat, longitude: lng };

  // Coarse, index-friendly prefilter so this route stops reading the entire
  // `sites` table on every request (T21.12 — an unbounded read silently
  // truncates at PostgREST's max-rows once the import pipeline grows the
  // table, dropping sites from the map with no error). The box is always a
  // superset of the radius circle (see `boundingBoxForRadius`), so the exact
  // circular filter below still decides what's actually in range — this only
  // narrows what comes back from the database.
  const bounds = boundingBoxForRadius(center, radiusMiles);

  // --- Local read: always first, and the only thing that can populate ---
  // --- this response's `error` field. ---
  const { sites: localSites, error: localError, truncated: localTruncated } = await listSitesInBounds({
    ...bounds,
    limit: SEARCH_NEARBY_ROW_LIMIT,
  });

  if (localError) {
    logger.error("search_nearby.local_query_failed", { error: localError, lat, lng, radiusMiles });
    return NextResponse.json({ sites: [], error: localError, searchedExternally: false, truncated: false }, { status: 200 });
  }

  // Tracks whichever result set actually ends up in the response —
  // `inRadius` gets reassigned below if the Overpass re-query succeeds, and
  // `truncated` must describe *that* set, not the one this route ends up
  // discarding. Found 2026-08-10 alongside `SEARCH_NEARBY_ROW_LIMIT`: this
  // route computed truncation but never told the caller, which is exactly
  // the silent-incomplete-list failure `queries.ts`'s own row-count-ceiling
  // comment (T21.12) already names as a correctness bug, not a nitpick —
  // more likely to actually bite now that a dense area routinely hits the
  // new, smaller cap.
  let truncated = localTruncated;
  if (truncated) {
    // Already logged inside listSitesInBounds; repeated here with the request
    // context that only this layer has, since a truncated result means the
    // thin-area check below is reasoning about an incomplete picture.
    logger.warn("search_nearby.local_result_truncated", { lat, lng, radiusMiles });
  }

  let inRadius = sortByDistanceWithinRadius(localSites, center, radiusMiles);
  let searchedExternally = false;

  // --- Thin-area fallback: Overpass, gated by (1) a signed-in user, ---
  // --- (2) the ~30-day-per-area cooldown + global daily cap. ---
  if (inRadius.length < LOCAL_RESULT_THRESHOLD) {
    const userId = await getAuthenticatedUserId();

    if (!userId) {
      // Anonymous visitors still get a working map — just no external
      // import triggered on their behalf. Not an error, not a non-200.
      logger.info("search_nearby.external_skipped_unauthenticated", {
        lat,
        lng,
        radiusMiles,
        localResults: inRadius.length,
      });
    }

    const allowedToSearch = userId !== null && (await claimExternalSearchWindow(center));

    if (allowedToSearch) {
      searchedExternally = true;

      const overpassResult = await queryOverpassNearby({ latitude: lat, longitude: lng, radiusMiles });

      if (overpassResult.error) {
        // Per this route's contract: an external failure is logged, never
        // surfaced as `error`, and never blocks the response — fall
        // through and serve whatever local data we already have.
        logger.warn("search_nearby.overpass_failed", {
          error: overpassResult.error,
          lat,
          lng,
          radiusMiles,
        });
      } else if (overpassResult.sites.length > 0) {
        const upsertResult = await upsertSitesFromOsm(overpassResult.sites);

        if (upsertResult.error) {
          logger.warn("search_nearby.osm_upsert_failed", { error: upsertResult.error });
        } else {
          logger.info("search_nearby.osm_import_complete", {
            // Who triggered the import — same `userId` field `dive-plans`
            // already logs, and the only way to trace an abusive importer
            // now that this path requires a signed-in user.
            userId,
            found: overpassResult.sites.length,
            inserted: upsertResult.inserted,
            skipped: upsertResult.skipped,
          });
        }

        // Re-query local sites so the response reflects anything just
        // imported. If this second read fails, fall back to the local data
        // already fetched above rather than losing it over an unrelated,
        // second failure.
        const refreshed = await listSitesInBounds({ ...bounds, limit: SEARCH_NEARBY_ROW_LIMIT });
        if (!refreshed.error) {
          inRadius = sortByDistanceWithinRadius(refreshed.sites, center, radiusMiles);
          truncated = refreshed.truncated;
        } else {
          logger.warn("search_nearby.post_import_requery_failed", { error: refreshed.error });
        }
      } else {
        logger.info("search_nearby.overpass_found_nothing", { lat, lng, radiusMiles });
      }
    }
  }

  return NextResponse.json({ sites: inRadius, error: null, searchedExternally, truncated }, { status: 200 });
}
