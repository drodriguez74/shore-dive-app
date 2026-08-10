import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for Server Components, Route Handlers, and
 * Server Actions — wired to Next.js's `cookies()` so auth state stays in
 * sync between the browser and the server.
 *
 * Deliberately NOT instantiated at module scope, same reasoning as
 * `src/lib/supabase/client.ts`: no real Supabase project exists yet
 * (P0-A.1), and this module (or the App Router tree that imports it) must
 * not throw just from being imported during static generation. The env-var
 * check only fires when a caller actually invokes `createClient()`.
 *
 * Must be created fresh per request — never cache/reuse across requests.
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local and fill in your Supabase project values.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` is called from Server Components in some code paths
          // (e.g. rendering after a `getUser()`/`getSession()` call), where
          // Next.js does not allow writing cookies. This is safe to ignore
          // as long as the proxy (`src/proxy.ts`) is refreshing sessions on
          // every request — it owns cookie writes for that case.
        }
      },
    },
    global: {
      // Found 2026-08-10: `/api/sites/search-nearby` (a Route Handler, not a
      // Server Component) was intermittently failing with a bare "TypeError:
      // fetch failed" specifically on larger bounding-box queries (250 mi,
      // ~435 rows) while the identical query succeeded instantly outside
      // Next's dev server — the query, bounds, and Supabase project were all
      // confirmed fine independently. Next.js App Router patches the global
      // `fetch` to add its own Data Cache, and Supabase's own Next.js SSR
      // guidance is to opt this client's fetch out of it explicitly — this
      // client's calls are always live reads against provenance-tagged data
      // (sites/hazard_reports/etc.), never something that should be served
      // from a stale Next-managed cache anyway.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
