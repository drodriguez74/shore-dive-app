/**
 * Per-area cooldown for the on-demand Overpass fallback (Task 21, T21.3).
 * plan.md v5 Resolved Decision #6 is explicit this is a real fair-use
 * requirement, not optional polish: `src/app/api/sites/search-nearby/route.ts`
 * must not call Overpass for the same rough geographic area more than once
 * per cooldown window, no matter how many users search it in the meantime.
 * Backed by the `external_search_area_cache` table
 * (`supabase/migrations/0009_external_search_area_cache.sql`).
 *
 * **Cooldown window: ~30 days, not 24h.** plan.md's original T21.3 spec
 * called for a 24h cooldown; the founder corrected this the same day (see
 * plan.md's "Amended same day" note on Resolved Decision #6 and priority
 * item 8): dive site *locations* don't change day-to-day, so a 24h TTL just
 * re-hits Overpass for the same area every single day for near-certainly
 * identical results — wasted calls against a fair-use-limited public API,
 * for zero real freshness benefit. This module implements the corrected
 * ~30-day cadence; `COOLDOWN_HOURS` below is expressed in hours only
 * because that's the unit `shouldSearchExternally`'s arithmetic already
 * used, not because the window is conceptually hourly.
 *
 * **Two independent limits live here, and they bound different things.**
 * The per-cell cooldown below bounds how often *one area* is re-searched;
 * `DAILY_EXTERNAL_SEARCH_CAP` bounds how many external searches happen
 * *in total* per rolling 24h. The cooldown alone is not a volume bound —
 * its key is a rounded 0.5-degree cell and there are ~259,200 of them
 * globally, so a caller that varies its coordinates never revisits a cell
 * and never trips the cooldown. Both must pass before an external call.
 *
 * Split into pure, unit-testable grid/cooldown math (no I/O) and a thin
 * Supabase-backed wrapper that actually reads/writes the cache table — same
 * shape `src/lib/webcam-extraction/rate-cap.ts` uses for its own
 * "checked-before-every-call gate" (injectable pure check + a real I/O
 * caller), so the logic is testable without a live Supabase project.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";

/** ~0.5 degrees (~34mi/~55km at the equator, narrower in longitude at
 * higher latitudes) — coarse on purpose, this is a rate-limit bucket key,
 * not a precise geofence. Two searches a few hundred feet apart must land
 * in the same cell. */
export const GRID_SIZE_DEGREES = 0.5;

/** The corrected ~30-day cooldown window (plan.md's same-day amendment to
 * Resolved Decision #6/T21.3 — see this file's header comment). Expressed
 * in hours (30 * 24) since `shouldSearchExternally`'s comparison is
 * hour-based. */
export const COOLDOWN_DAYS = 30;
export const COOLDOWN_HOURS = COOLDOWN_DAYS * 24;

/** Matches `sites.external_source`'s convention (0008_sites_external_source.sql)
 * — a short slug, room for a second external source later without a schema
 * change. */
export const EXTERNAL_SEARCH_SOURCE = "osm";

/**
 * Global ceiling on how many external (Overpass) searches this deployment
 * may trigger in any rolling 24h window, across *all* users and *all* grid
 * cells combined.
 *
 * Why this exists on top of the per-cell cooldown above: the cooldown keys
 * on a rounded 0.5-degree cell, and there are ~259,200 such cells globally.
 * A caller that simply varies its coordinates never hits the same cell
 * twice and therefore never hits the cooldown at all — so the cooldown
 * alone bounds *repeat* searches of one area, not *total* call volume. This
 * cap is the bound on total volume, which is what Overpass's fair-use
 * policy (`supabase/sources/dive-site-data-source-options.md`) actually
 * cares about, and what keeps a runaway/abusive caller from generating
 * unbounded automated writes into `sites`.
 *
 * **The number isn't sacred.** 100/day is a deliberately conservative
 * starting point, not a measured limit: real organic use of this app (a
 * handful of divers searching their own coastline) is nowhere near it,
 * while a scripted sweep of new coordinates would blow past it within
 * minutes. Raise it if legitimate use ever bumps into it — the value that
 * matters is that *some* finite global bound exists, not this exact one.
 */
export const DAILY_EXTERNAL_SEARCH_CAP = 100;

/** Rolling window the cap is measured over. 24h, matching how Overpass's
 * usage policy talks about daily volume. */
export const DAILY_CAP_WINDOW_HOURS = 24;

/** Start of the rolling cap window (i.e. `now` minus the window length).
 * Pure/no I/O — split out so the counting query and its tests agree on one
 * definition of "today" instead of each computing their own. */
export function dailyCapWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - DAILY_CAP_WINDOW_HOURS * 60 * 60 * 1000);
}

/**
 * Injectable "how many external searches were claimed in the current
 * window" counter — same dependency-injection shape as
 * `src/lib/webcam-extraction/rate-cap.ts`'s `TodayCallCounter`, so the cap
 * decision is unit-testable without a live Supabase project.
 */
export type RecentExternalSearchCounter = () => Promise<number>;

export interface DailyCapCheckResult {
  allowed: boolean;
  /** Claims already made in the window. `Infinity` when the count itself couldn't be determined (fail-closed). */
  searchesInWindow: number;
  cap: number;
  reason?: "cap-reached" | "count-unavailable";
}

/**
 * The global-cap half of the gate. Callers must treat `allowed: false` as a
 * hard stop on calling the external API this request.
 *
 * Fails closed, same posture as `shouldSearchExternally` and
 * `claimExternalSearchWindow`: if the count can't be determined (the query
 * threw, no live project, etc.) this returns `allowed: false` rather than
 * assuming zero searches have happened — an unknown volume must never be
 * treated as "safely under the cap."
 */
export async function checkDailyExternalSearchCap(
  countInWindow: RecentExternalSearchCounter,
  cap: number = DAILY_EXTERNAL_SEARCH_CAP,
): Promise<DailyCapCheckResult> {
  let searchesInWindow: number;

  try {
    searchesInWindow = await countInWindow();
  } catch (error) {
    logger.error("external_search_cache.daily_count_failed", { error: errorMessage(error) });
    return { allowed: false, searchesInWindow: Number.POSITIVE_INFINITY, cap, reason: "count-unavailable" };
  }

  if (!Number.isFinite(searchesInWindow) || searchesInWindow < 0) {
    // A non-finite/negative count is a broken counter, not a low count —
    // same fail-closed reasoning as the catch above.
    logger.error("external_search_cache.daily_count_invalid", { searchesInWindow });
    return { allowed: false, searchesInWindow: Number.POSITIVE_INFINITY, cap, reason: "count-unavailable" };
  }

  if (searchesInWindow >= cap) {
    logger.warn("external_search_cache.daily_cap_reached", { searchesInWindow, cap });
    return { allowed: false, searchesInWindow, cap, reason: "cap-reached" };
  }

  return { allowed: true, searchesInWindow, cap };
}

export interface GridCell {
  gridLat: number;
  gridLng: number;
}

/**
 * Rounds a coordinate to the nearest `GRID_SIZE_DEGREES` cell. Pure/no I/O
 * — the caching table stores exactly what this returns.
 */
export function roundToGridCell(latitude: number, longitude: number): GridCell {
  const round = (value: number) => Math.round(value / GRID_SIZE_DEGREES) * GRID_SIZE_DEGREES;
  // toFixed guards against float artifacts (e.g. 26.499999999999996) before
  // the value round-trips through a numeric(5,2)/(6,2) column.
  return {
    gridLat: Number(round(latitude).toFixed(2)),
    gridLng: Number(round(longitude).toFixed(2)),
  };
}

/**
 * Whether a new external search is allowed for an area whose most recent
 * search was at `lastSearchedAt` (an ISO timestamp, or `null` if the area
 * has never been searched). Pure/no I/O — `now` is injectable for tests.
 *
 * Fails toward the cooldown (returns `false`, i.e. "don't search again
 * yet") on an unparseable timestamp — an unreadable cache state must never
 * be treated as "safe to call Overpass," matching the same fail-toward-the-
 * conservative-answer posture `webcam-extraction/rate-cap.ts` uses for its
 * own quota check.
 */
export function shouldSearchExternally(lastSearchedAt: string | null, now: Date = new Date()): boolean {
  if (!lastSearchedAt) return true;
  const last = new Date(lastSearchedAt);
  if (Number.isNaN(last.getTime())) return false;
  const hoursSinceLastSearch = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastSearch >= COOLDOWN_HOURS;
}

/**
 * The real, Supabase-backed gate `search-nearby/route.ts` calls. Two
 * independent checks must both pass before a claim is made:
 *
 * 1. this area's per-cell cooldown has expired (`shouldSearchExternally`), and
 * 2. the deployment is under its global rolling-24h cap
 *    (`checkDailyExternalSearchCap` — see `DAILY_EXTERNAL_SEARCH_CAP` for
 *    why the per-cell cooldown alone is not a volume bound).
 *
 * If both pass, the area is claimed (stamps `last_searched_at = now`) so a
 * concurrent request for the same area doesn't also fire an Overpass call.
 * Returns `true` only when the caller may proceed with an external search
 * this request.
 *
 * The global count is derived from this same table rather than a new
 * counter table: `external_search_area_cache` already holds exactly one row
 * per claimed cell, and a cell can't be re-claimed inside its ~30-day
 * cooldown, so "rows whose `last_searched_at` falls in the last 24h" is an
 * exact count of external searches claimed in that window — no migration,
 * no second source of truth that could drift from the real claims.
 *
 * Never throws. If the cache check/claim itself fails (DB error, no live
 * project configured, etc.), fails closed — returns `false` — because an
 * unknown cooldown state must never be treated as "safe to call the
 * external API." Degrading to "skip the external search this time, serve
 * local data" is always an acceptable outcome per Task 21's spec; silently
 * bypassing the fair-use cooldown is not.
 *
 * Known race, accepted for v1: the check-then-write below is two separate
 * round trips, not one atomic statement, so two requests for the same area
 * arriving within milliseconds of each other could both pass the check
 * before either writes the claim, resulting in two Overpass calls instead
 * of one. Low-stakes for this app's real traffic volume; a stricter
 * single-statement claim (e.g. a conditional upsert) is a reasonable
 * future hardening, not required for correctness today.
 */
export async function claimExternalSearchWindow(
  center: { latitude: number; longitude: number },
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { gridLat, gridLng } = roundToGridCell(center.latitude, center.longitude);

    const { data, error } = await admin
      .from("external_search_area_cache")
      .select("last_searched_at")
      .eq("external_source", EXTERNAL_SEARCH_SOURCE)
      .eq("grid_lat", gridLat)
      .eq("grid_lng", gridLng)
      .maybeSingle<{ last_searched_at: string }>();

    if (error) throw error;

    if (data && !shouldSearchExternally(data.last_searched_at, now)) {
      logger.info("external_search_cache.on_cooldown", { gridLat, gridLng, lastSearchedAt: data.last_searched_at });
      return false;
    }

    // Global volume bound, checked after the (cheaper, single-indexed-row)
    // cooldown lookup so an already-on-cooldown area doesn't pay for a
    // count query it can't use.
    const capCheck = await checkDailyExternalSearchCap(async () => {
      const { count, error: countError } = await admin
        .from("external_search_area_cache")
        .select("id", { count: "exact", head: true })
        .gte("last_searched_at", dailyCapWindowStart(now).toISOString());

      if (countError) throw countError;
      // PostgREST can return a null count (e.g. when the count wasn't
      // computed); an absent count is an unknown count, not zero.
      if (count === null) throw new Error("external_search_area_cache count unavailable");
      return count;
    });

    if (!capCheck.allowed) {
      logger.warn("external_search_cache.skipped_daily_cap", {
        gridLat,
        gridLng,
        searchesInWindow: capCheck.searchesInWindow,
        cap: capCheck.cap,
        reason: capCheck.reason,
      });
      return false;
    }

    // external_search_area_cache_cell_idx (0009) is a plain, non-partial
    // unique index on (external_source, grid_lat, grid_lng) — unlike
    // sites_external_source_id_idx (0008), a plain ON CONFLICT upsert works
    // fine against it.
    const { error: upsertError } = await admin.from("external_search_area_cache").upsert(
      { external_source: EXTERNAL_SEARCH_SOURCE, grid_lat: gridLat, grid_lng: gridLng, last_searched_at: now.toISOString() },
      { onConflict: "external_source,grid_lat,grid_lng" },
    );

    if (upsertError) throw upsertError;

    logger.info("external_search_cache.claimed", { gridLat, gridLng });
    return true;
  } catch (error) {
    logger.error("external_search_cache.claim_failed", { error: errorMessage(error) });
    return false;
  }
}
