import Link from "next/link";
import { listLdsStatusMarkers } from "@/lib/sites/queries";
import { FillStationsList } from "@/components/lds/fill-stations-list";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";

/**
 * "Fill Stations & Gear" (2026-08-13, closing a gap found in that day's UX
 * audit, `TASKS.md` T25 — dive-shop-owner persona): LDS/fill-station status
 * was only ever reachable via a small map pin's popup, buried among
 * dive-site pins on the homepage map, with no dedicated page. Built against
 * `creative/mockups/lds-moderation/01-lds-status-list.html`.
 *
 * Public read, same as the homepage's LDS pins — `listLdsStatusMarkers()`
 * already never throws and degrades to an honest empty/error state, so this
 * page follows the same "force-dynamic Server Component doing the real
 * fetch, a client component underneath for interaction" split as `/`.
 */

export const dynamic = "force-dynamic";

/**
 * Same helper (and same fail-toward-signed-out reasoning) as
 * `src/app/page.tsx`'s: reading it wrong only costs a redundant sign-in
 * prompt on the report form, whereas throwing would take down a page whose
 * actual content is public. Task 16's real write path
 * (`/api/lds/submit`) re-checks the session server-side regardless — this
 * is a UX affordance, not the security boundary.
 */
async function isSignedIn(): Promise<boolean> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user !== null;
  } catch (error) {
    logger.warn("fill_stations.auth_check_failed", { error: errorMessage(error) });
    return false;
  }
}

export default async function FillStationsPage() {
  const [{ markers, error }, signedIn] = await Promise.all([listLdsStatusMarkers(), isSignedIn()]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Shore Dive
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Fill Stations &amp; Gear
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Air, O2, and emergency gear reported by shops and divers nearby.
          </p>
        </div>

        {error && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Couldn&apos;t load fill-station status ({error}). Try reloading.
          </p>
        )}

        {!error && <FillStationsList markers={markers} isSignedIn={signedIn} />}
      </main>
    </div>
  );
}
