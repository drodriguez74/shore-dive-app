import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/supabase/profile";

/**
 * OAuth callback for Supabase's Google sign-in redirect flow (P0-A.4).
 * Google redirects here with a `code` query param; we exchange it for a
 * session, then redirect the user into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Missing sign-in code from Google.")}`,
    );
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`,
      );
    }

    // Best-effort: populate the profiles row on first sign-in (P0-A.6).
    // The `profiles` table doesn't exist in any live database yet (schema
    // migration is in progress in parallel) — a failure here must never
    // block the user from completing sign-in, so we swallow it after
    // logging. See src/lib/supabase/profile.ts for details.
    if (data.user) {
      try {
        await ensureProfile(data.user.id);
      } catch (profileError) {
        console.error("[auth/callback] ensureProfile threw unexpectedly", {
          userId: data.user.id,
          error:
            profileError instanceof Error
              ? profileError.message
              : profileError,
        });
      }
    }

    return NextResponse.redirect(`${origin}${next}`);
  } catch (err) {
    console.error("[auth/callback] session exchange failed", {
      error: err instanceof Error ? err.message : err,
    });
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign-in failed. Please try again.")}`,
    );
  }
}
