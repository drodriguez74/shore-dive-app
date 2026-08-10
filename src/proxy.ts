import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session-refresh proxy (P0-A.5).
 *
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 deprecated the
 * `middleware.ts` file convention in favor of `proxy.ts` (same behavior,
 * renamed export) — see `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md` and the `middleware-to-proxy` codemod. Using
 * the deprecated name would emit a build-time warning for no benefit.
 *
 * Refreshes the Supabase auth session on every non-static request and keeps
 * the session cookie in sync between the browser and server, per the
 * standard `@supabase/ssr` proxy/middleware pattern. Runs before Server
 * Components render, so it's the one place that reliably sees (and can
 * rewrite) an about-to-expire session cookie.
 *
 * Deliberately does NOT throw when Supabase env vars are missing — no real
 * project exists yet (P0-A.1), and this file runs on every matched request,
 * including in local/dev/build contexts without `.env.local` configured. It
 * just no-ops and passes the request through.
 */
export async function proxy(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    // Touches the network to validate/refresh the token; the result itself
    // isn't used here — this call is what triggers `setAll` above to write
    // a refreshed cookie back onto the response when needed.
    await supabase.auth.getUser();
  } catch (error) {
    // Network/Supabase failures here must not take down every page request
    // (offline-first app — see CLAUDE.md's exception-handling standard).
    console.error("[proxy] session refresh failed", {
      error: error instanceof Error ? error.message : error,
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on everything except:
     * - _next/static (build assets)
     * - _next/image (image optimization)
     * - favicon.ico, manifest/icons, sw.js (PWA assets)
     * - files with an extension (images, etc. served from /public)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
