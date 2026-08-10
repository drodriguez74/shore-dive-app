import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY. Do not import this from a client component (`"use client"`)
 * or anything reachable from one — it reads `SUPABASE_SERVICE_ROLE_KEY`, a
 * secret that bypasses Row-Level Security entirely and must never ship to
 * the browser.
 *
 * This is the "requires the Supabase service-role key" escape hatch that
 * `supabase/migrations/0003_camera_sources.sql` and `0002_rls.sql` both
 * document: `camera_sources` (and `sites`/`hazard_reports`/`lds_status`)
 * deliberately have no RLS UPDATE policy for authenticated users, because no
 * moderator/admin role exists anywhere in this schema yet. Approving or
 * rejecting a `camera_sources` row (T19.3) has to go through a client that
 * bypasses RLS, which is exactly what the service-role key does.
 *
 * **Honest gap (see `supabase/README.md` item 6 and the header comment on
 * `src/app/api/camera-sources/[id]/review/route.ts`): possessing this
 * client bypasses RLS unconditionally. It is not scoped to "is a
 * moderator" because that concept doesn't exist in the schema yet — any
 * code path that reaches this module is trusted, full stop. Every caller is
 * responsible for its own authorization check before using it; this module
 * does not and cannot enforce one.**
 *
 * Deliberately NOT instantiated at module scope, same reasoning as
 * `src/lib/supabase/client.ts` / `server.ts`: no real Supabase project
 * exists yet (P0-A.1), and this module (or the route tree that imports it)
 * must not throw just from being imported during a build. The env-var check
 * only fires when a caller actually invokes `createAdminClient()`.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    // Defense in depth: this should be unreachable (the service-role key
    // is never exposed to the client bundle, so nothing here would work
    // in the browser anyway), but fail loudly rather than silently if a
    // future refactor ever accidentally pulls this into client code.
    throw new Error(
      "createAdminClient() must never run in the browser — it uses the Supabase service-role key, " +
        "which bypasses Row-Level Security.",
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.local.example to " +
        ".env.local and fill in your Supabase project's service-role key (Project Settings > API). " +
        "No real Supabase project exists yet as of T19.2/T19.3 — this is expected to throw until one does.",
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // A service-role client is not a user session — never persist or
      // refresh a token for it.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
