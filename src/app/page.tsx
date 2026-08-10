import Link from "next/link";
import { DiveSiteExplorer } from "@/components/dive-site-explorer";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { listSitesWithHazardFlag, listLdsStatusMarkers } from "@/lib/sites/queries";
import { logger } from "@/lib/sites/logger";

// Task 11.5: this page now does a real Supabase read (via listSitesWithHazardFlag,
// which itself checks auth/env state and never throws — see its own header
// comment). force-dynamic so a newly-added site shows up without a stale
// build-time cache, matching src/app/moderation/camera-sources/page.tsx's
// convention for the same reason.
export const dynamic = "force-dynamic";

/**
 * Whether this visitor is signed in — used only to decide whether the
 * nearby-sites panel should explain that signing in unlocks the
 * OpenStreetMap search (`T21.13` gated that path behind auth, which
 * otherwise leaves an anonymous diver at a silent dead end: "no dive sites
 * near you" with no hint that more are findable). Never gates *reading*
 * anything — site data is public by design.
 *
 * Fails toward "signed out" if the check throws: the only consequence is
 * showing a sign-in hint to someone who may already be signed in, which is
 * mildly redundant rather than misleading or blocking.
 */
async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user !== null;
  } catch (error) {
    logger.warn("home.auth_check_failed", { error: errorMessage(error) });
    return false;
  }
}

export default async function Home() {
  const [{ sites, error: sitesError }, { markers: ldsMarkers, error: ldsError }, signedIn] = await Promise.all([
    listSitesWithHazardFlag(),
    listLdsStatusMarkers(),
    isSignedIn(),
  ]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Shore Dive
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Real dive sites, plus LDS/fill-station pins (Task 16) — tap a pin for its provenance and
            last-verified time.
          </p>
          <Link
            href="/safe-return"
            className="mt-2 inline-block text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            Safe-Return timer →
          </Link>
        </div>
        {/* T21.6 (plan.md Resolved Decision #8): the map and the "Dive sites
            near you" list below used to be independent siblings here, each
            managing its own state — changing the list's radius selector
            never moved the map's pins. DiveSiteExplorer now owns geolocation
            + radius + the search-nearby result set once and feeds both the
            migrated GeoJSON/symbol-layer map (T21.7) and the (now purely
            presentational) list from the same data. This page stays a
            Server Component doing the initial full-list fetch above,
            unchanged — DiveSiteExplorer is the client boundary.
            Task 11.5's map-pin fix is still the primary way to reach a site,
            but the list works with or without a Mapbox token configured (the
            map component itself degrades to a bare placeholder sentence with
            no token — see site-map.tsx) and needs zero pin-tapping to use.
            This is deliberately NOT the full designed Mapbox-degraded-fallback
            flow (creative/flows/map-exploration.md's scrollable-card list) —
            that's a separate, still-open gap (out of scope for this batch,
            noted for the founder). */}
        <DiveSiteExplorer sites={sites} ldsMarkers={ldsMarkers} isSignedIn={signedIn} />
        {sitesError && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Couldn&apos;t load dive sites from Supabase ({sitesError}). Map/list will be empty until this is
            resolved.
          </p>
        )}
        {ldsError && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Couldn&apos;t load LDS/fill-station status from Supabase ({ldsError}). Those pins will be empty until
            this is resolved.
          </p>
        )}
      </main>
    </div>
  );
}
