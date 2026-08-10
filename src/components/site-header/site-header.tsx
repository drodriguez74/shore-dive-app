import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/site-header/logger";
import { SignOutButton } from "./sign-out-button";

/**
 * Global site header — was missing entirely before this. `P0-A.4` built the
 * sign-in page and OAuth callback route; `P0-A.5` was tracked as "session
 * handling / auth guard for protected routes" but `src/proxy.ts` only ever
 * delivered the session-refresh half — it has no route-protection logic at
 * all, and nothing anywhere linked to `/login`. The page worked, it just
 * wasn't reachable. This is the fix: a header, present on every route via
 * `layout.tsx`, that always shows a real way to sign in or out.
 *
 * Deliberately an async Server Component, not client-side state — the same
 * "check auth server-side, render the real state, no client flash-of-wrong-
 * state" pattern `src/app/moderation/camera-sources/page.tsx` already uses.
 * Only the sign-out *action* needs a client component (`SignOutButton`),
 * since it has to call the browser Supabase client.
 *
 * Deliberately does NOT gate/redirect any route here — most of this app is
 * intentionally public (map, hazard data, and LDS status are all publicly
 * readable per `0002_rls.sql`'s RLS policies; the Safe-Return timer is
 * local-only and needs no account). Pages that genuinely require sign-in
 * (`/moderation/camera-sources`, `/webcam-discovery`) already do their own
 * inline auth check and render a real "sign in" prompt rather than a bare
 * redirect — this header doesn't duplicate that, it just makes `/login`
 * reachable in the first place.
 */
export async function SiteHeader() {
  let userEmail: string | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  } catch (error) {
    // Missing/misconfigured Supabase env vars, or a network failure — never
    // let the header crash the whole page over an auth check. Render as
    // signed-out; every "sign-in required" surface downstream will catch
    // the real failure with its own error message if the user tries.
    logger.warn("auth-check-failed", { error: errorMessage(error) });
  }

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-depth-border dark:bg-depth-1">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="font-display text-base font-semibold tracking-tight text-black dark:text-zinc-50">
          Shore Dive
        </Link>

        <nav className="flex items-center gap-4">
          <Link
            href="/safe-return"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Safe-Return
          </Link>

          {userEmail ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">{userEmail}</span>
              <SignOutButton />
            </div>
          ) : (
            <Link
              href="/login"
              className="min-h-[36px] rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
