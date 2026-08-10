"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Reads the `?error=` query param that `src/app/auth/callback/route.ts`
 * appends when a server-side OAuth failure sends the user back here
 * (missing `code`, a failed `exchangeCodeForSession`, or a thrown
 * exception) and feeds it into the same `error` state the client-side
 * sign-in path (`handleGoogleSignIn` below) already populates, so the
 * existing error banner renders it without a second UI.
 *
 * This lives in its own component wrapped in <Suspense> because
 * `useSearchParams` requires a Suspense boundary for a statically
 * rendered route, or `next build` fails with "Missing Suspense boundary
 * with useSearchParams" (confirmed against this Next.js version's docs
 * in node_modules/next/dist/docs, per AGENTS.md's API-drift note).
 *
 * The param is stripped from the URL with `router.replace` right after
 * being read, so refreshing /login doesn't keep re-showing an error
 * from a sign-in attempt that's already over.
 */
function OAuthCallbackError({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const callbackError = searchParams.get("error");
    if (!callbackError) return;

    onError(callbackError);

    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    const query = params.toString();
    router.replace(query ? `/login?${query}` : "/login");
  }, [searchParams, router, onError]);

  return null;
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleGoogleSignIn() {
    setError(null);
    setIsPending(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signInError) {
        setError(signInError.message);
        setIsPending(false);
      }
      // On success the browser is redirected to Google, then back to
      // /auth/callback — nothing else to do here.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong starting sign-in.",
      );
      setIsPending(false);
    }
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-zinc-50 font-sans dark:bg-depth-0">
      {/* Picks up a server-side OAuth failure surfaced via /login?error=...
          (see auth/callback/route.ts) and feeds it into the same `error`
          state the client-side sign-in path uses below. Renders nothing
          itself. */}
      <Suspense fallback={null}>
        <OAuthCallbackError onError={setError} />
      </Suspense>
      {/* Soft brand-gradient glow behind the card — the "moment of weight" for
          this screen, per DESIGN_SYSTEM.md §2.3. Google's own brand guidelines
          dictate the button's look, so the gradient lives around it, not on
          it — see creative/mockups/onboarding/02-sign-in.html. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-120px] hidden h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gradient-dive opacity-25 blur-[90px] dark:block"
      />
      <main className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-10">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Sign in to Shore Dive
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Google sign-in only — free, no phone number required.
          </p>
        </div>

        {/* Google's own brand requirements dictate this button's look — kept
            as the light/neutral variant Google provides, unthemed for dark
            mode on purpose (matches creative/mockups/onboarding/02-sign-in.html). */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isPending}
          className="flex min-h-[52px] items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.86z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A11.99 11.99 0 0 0 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.28A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.28 5.37z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.63l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z"
            />
          </svg>
          {isPending ? "Redirecting…" : "Continue with Google"}
        </button>

        {/* Single error banner, shared by both failure paths: a client-side
            sign-in-start failure (handleGoogleSignIn's catch above) and a
            server-side OAuth failure read from ?error= by
            OAuthCallbackError above. */}
        {error ? (
          <p
            role="alert"
            className="text-sm text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        ) : null}

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          By signing in you agree this is a free, hobby project — see the
          onboarding notes for what account data we store and why.
        </p>
      </main>
    </div>
  );
}
