import { createClient } from "./server";

/**
 * Ensures a `profiles` row exists for a newly (or returning) authenticated
 * user — the "populated on first sign-in" half of P0-A.6.
 *
 * NOTE: the `profiles` table schema itself is being designed/migrated in
 * parallel (see P0-A.6 / P0-B) and does not exist in any live database yet.
 * This function is written against the shape that migration is expected to
 * produce (`id` matching `auth.users.id`, `created_at`), but it genuinely
 * cannot succeed until that migration has been applied to a real Supabase
 * project. Callers must not let a failure here break the surrounding flow —
 * see the call site in `src/app/auth/callback/route.ts`, which swallows
 * errors from this function by design.
 */
export async function ensureProfile(userId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    // Expected until the `profiles` table migration lands (P0-A.6/P0-B) —
    // log with context for when structured logging is wired up, but don't
    // throw: a missing/misconfigured profiles table must never block sign-in.
    console.error("[ensureProfile] failed to upsert profile", {
      userId,
      message: error.message,
      code: error.code,
    });
  }
}
