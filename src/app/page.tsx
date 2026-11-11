import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import { DiveSiteExplorer } from "@/components/dive-site-explorer";
import { WelcomeGate } from "@/components/onboarding/welcome-gate";
import { SafeReturnHomeCard } from "@/components/safe-return-home-card";
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
    if (!hasSupabaseSessionCookie((await cookies()).getAll())) return false;
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
  const signedIn = await isSignedIn();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      {/* Additive overlay — server always renders the real homepage below
          unchanged; this decides, client-side only, whether a first-time
          signed-out visitor should also see the Welcome pitch on top. See
          welcome-gate.tsx's own header for the full hydration-safety
          reasoning. */}
      <WelcomeGate isSignedIn={signedIn} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Shore Dive
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Real shore-accessible dive sites, plus nearby air-fill shops — tap any pin for who verified it and
            when.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/fill-stations" className="font-medium text-sky-700 hover:underline dark:text-sky-400">
              Fill stations &amp; gear →
            </Link>
            {signedIn && (
              <Link href="/dive-plans" className="font-medium text-sky-700 hover:underline dark:text-sky-400">
                My dive plans →
              </Link>
            )}
            <Link href="/offline" className="font-medium text-sky-700 hover:underline dark:text-sky-400">
              Saved for offline →
            </Link>
          </div>
        </div>
        {/* TASKS.md T26 (2026-08-13 UX audit): previously a single
            unexplained text link ("Safe-Return timer →") — the single most
            safety-relevant feature in the app deserved more than that. See
            safe-return-home-card.tsx's own header for the full reasoning. */}
        <SafeReturnHomeCard />
        {/* The catalogue read is the slow part of this page, so it streams in
            behind the header, links and Safe-Return card instead of blocking them. */}
        <Suspense fallback={<ExplorerSkeleton />}>
          <ExplorerSection signedIn={signedIn} />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Server-fetches the full site list (the explorer's fallback before a
 * location resolves, for the "All" radius, and if nearby search fails) and
 * fill-station markers, then hands both to the client explorer.
 */
async function ExplorerSection({ signedIn }: { signedIn: boolean }) {
  const [{ sites, error: sitesError }, { markers: ldsMarkers, error: ldsError }] = await Promise.all([
    listSitesWithHazardFlag(),
    listLdsStatusMarkers(),
  ]);

  return (
    <>
      <DiveSiteExplorer
        sites={sites}
        ldsMarkers={ldsMarkers}
        isSignedIn={signedIn}
        sitesLoadFailed={Boolean(sitesError)}
      />
      {/* Raw error text stays in the server log (queries.ts logs it), not in diver-facing copy. */}
      {sitesError && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t reach the dive-site database, so the map and list are empty for now. That&apos;s a
          problem on our side, not a sign there are no sites near you — try again shortly.
        </p>
      )}
      {ldsError && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t load fill-station status either — those pins will be missing until the database is
          reachable again.
        </p>
      )}
    </>
  );
}

function ExplorerSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <div className="h-[420px] w-full animate-pulse rounded-2xl bg-zinc-200 dark:bg-depth-2" />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading dive sites…</p>
    </div>
  );
}
