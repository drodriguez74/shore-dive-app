import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for Client Components.
 *
 * Deliberately NOT instantiated at module scope: no real Supabase project
 * exists yet (P0-A.1, a pending founder action — `.env.local` has no real
 * values). If this threw at import time, any page that imports something in
 * this module's tree — even one that never calls `createClient()` — would
 * crash `npm run build` during static generation. Instead we throw only when
 * a caller actually invokes this function without the env vars configured,
 * which is the correct failure point.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.local.example to .env.local and fill in your Supabase project values.",
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
