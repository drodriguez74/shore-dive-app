"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/site-header/logger";

/**
 * Sign-out was missing entirely before this — you could reach `/login` and
 * complete Google OAuth, but nothing anywhere called `auth.signOut()`. Kept
 * minimal deliberately: no confirmation dialog (unlike the Safe-Return
 * timer's hold-to-confirm pattern, this isn't a safety-critical or
 * hard-to-reverse action — signing back in is one click away).
 */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSignOut() {
    setIsPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        logger.warn("sign-out-failed", { error: error.message });
      }
    } catch (err) {
      // Network/Supabase failures here must not trap the user on a broken
      // button — fall through to refresh either way, matching proxy.ts's
      // "auth failures never take down the request" standard.
      logger.error("sign-out-unexpected-error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsPending(false);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isPending}
      className="min-h-[36px] rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-depth-border dark:text-zinc-300 dark:hover:border-depth-3"
    >
      {isPending ? "Signing out…" : "Sign out"}
    </button>
  );
}
