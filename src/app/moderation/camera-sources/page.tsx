import Link from "next/link";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CameraSource } from "@/lib/camera-sources/types";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/camera-sources/logger";
import { ModerationQueueClient } from "./queue-client";

// T19.2 moderation-queue route — deliberately self-contained and NOT linked
// from the homepage, same "real but not yet integrated" convention as
// `/media-demo` (T20) and `/post-dive` (T14): exists to exercise the real
// approve/reject flow (T19.3) against `camera_sources`, since there's no
// real end-to-end discovery-agent -> queue -> allowlist flow wired up yet
// (T19.1, the discovery agent itself, hasn't been built).
//
// ## Why this page uses the service-role client to READ the queue too
//
// `camera_sources`' RLS (0003_camera_sources.sql) only lets a regular
// authenticated user read their OWN submitted rows regardless of status —
// not everyone else's pending candidates. A real moderation queue has to see
// every pending row, not just the current user's, so listing the queue is
// itself a privileged read, not just the approve/reject write. This mirrors
// `supabase/README.md`'s own framing: "[service-role key], eventually
// Task 19.2's moderation-queue UI running with elevated privilege." See
// `src/lib/supabase/admin.ts` and the header comment on
// `src/app/api/camera-sources/[id]/review/route.ts` for the full honest-gap
// writeup — the short version: this page is gated on "signed in," not on
// "is actually a moderator," because no moderator role exists in this
// schema yet.

export const dynamic = "force-dynamic";

const RECENTLY_DECIDED_LIMIT = 20;

export default async function CameraSourcesModerationPage() {
  const isConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!isConfigured) {
    return (
      <PageShell>
        <NoticeCard title="Supabase is not configured yet">
          <p>
            This page needs <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, and{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">SUPABASE_SERVICE_ROLE_KEY</code> set in{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code> — copy{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local.example</code> and fill in a real
            Supabase project&apos;s values. No real project exists yet as of T19.2/T19.3.
          </p>
        </NoticeCard>
      </PageShell>
    );
  }

  let userId: string | null = null;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch (error) {
    logger.error("moderation_page.auth_check_failed", {
      error: errorMessage(error),
    });
    return (
      <PageShell>
        <NoticeCard title="Could not check sign-in status">
          <p>Something went wrong verifying your session. Try reloading, or sign in again.</p>
        </NoticeCard>
      </PageShell>
    );
  }

  if (!userId) {
    return (
      <PageShell>
        <NoticeCard title="Sign-in required">
          <p>
            You must be signed in to view the moderation queue. Note this only checks that you&apos;re signed
            in — see the security-gap notice below for what that does and doesn&apos;t mean.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            Sign in
          </Link>
        </NoticeCard>
      </PageShell>
    );
  }

  let pending: CameraSource[] = [];
  let decided: CameraSource[] = [];
  let loadError: string | null = null;

  try {
    const admin = createAdminClient();

    const [pendingResult, decidedResult] = await Promise.all([
      admin
        .from("camera_sources")
        .select("*")
        .eq("status", "pending_review")
        .order("created_at", { ascending: true })
        .returns<CameraSource[]>(),
      admin
        .from("camera_sources")
        .select("*")
        .in("status", ["approved", "rejected"])
        .order("reviewed_at", { ascending: false })
        .limit(RECENTLY_DECIDED_LIMIT)
        .returns<CameraSource[]>(),
    ]);

    if (pendingResult.error) {
      throw pendingResult.error;
    }
    if (decidedResult.error) {
      throw decidedResult.error;
    }

    pending = pendingResult.data ?? [];
    decided = decidedResult.data ?? [];
  } catch (error) {
    logger.error("moderation_page.queue_fetch_failed", {
      error: errorMessage(error),
    });
    loadError =
      error instanceof Error
        ? error.message
        : "Could not load the moderation queue. Supabase may not be configured yet, or the camera_sources table doesn't exist on this project.";
  }

  return (
    <PageShell>
      <SecurityGapNotice />
      {loadError ? (
        <NoticeCard title="Could not load the queue">
          <p>{loadError}</p>
        </NoticeCard>
      ) : (
        <ModerationQueueClient initialPending={pending} initialDecided={decided} />
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Shore Dive
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Camera Sources — Moderation Queue
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Human review for webcam-allowlist candidates (T19.2/T19.3). A row is never usable/embeddable by the
            app until it&apos;s approved here. Demo/test route — not linked from the homepage.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}

function NoticeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      <h2 className="font-semibold text-black dark:text-zinc-50">{title}</h2>
      <div className="mt-1 flex flex-col gap-2">{children}</div>
    </div>
  );
}

// Copy here is user-facing — a shop owner or moderator reads this, not a
// developer. Keep the disclosure (real, deliberate, not softened) but keep
// implementation details (file names, migration paths) out of it; per the
// 2026-08-08 aesthetic review (independently flagged by both the dive-shop
// and business reviewers), inline file paths made this read like a leaked
// engineering ticket rather than a considered product decision. The
// technical cross-references still belong somewhere — they're here, in this
// comment, for the next developer: this is the same service-role-only gap
// `supabase/migrations/0002_rls.sql` and `supabase/README.md` document for
// promoting community content to `VERIFIED`, not something this page can
// fix on its own — see this file's header comment and
// `src/app/api/camera-sources/[id]/review/route.ts` for the full writeup.
function SecurityGapNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:text-amber-200">
      <p className="font-semibold">Heads up: anyone signed in can approve or reject candidates here.</p>
      <p className="mt-1">
        There&apos;s no moderator role yet — this queue currently checks only that you&apos;re signed in, not
        that you&apos;re a trusted reviewer. Review candidates carefully; this will get tightened before any
        public launch.
      </p>
    </div>
  );
}
