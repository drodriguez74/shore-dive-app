import Link from "next/link";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/webcam-discovery/logger";
import { DiscoveryForm } from "./discovery-form";

/**
 * T19.1 manual-trigger surface for the webcam candidate-discovery
 * workflow. Deliberately self-contained and NOT linked from the homepage
 * -- same "demo/test harness, exists to exercise real logic end-to-end"
 * convention as `/media-demo` (T20), `/post-dive` (T14), and
 * `/moderation/camera-sources` (T19.2/T19.3). Reachable directly at
 * `/webcam-discovery`.
 *
 * There's no live/autonomous discovery step to trigger here (see
 * `src/lib/webcam-discovery/discover-candidates.ts`'s header --
 * THREAT_MODEL.md §9's legal-review gate hasn't cleared) -- this page
 * exists to run the real extract -> submit half of the pipeline against
 * candidate URLs you supply yourself, and to make that boundary visible
 * rather than papering over it with a "discover" button that would need
 * to lie about what it does.
 */

// Forces per-request rendering, same reasoning as
// `src/app/moderation/camera-sources/page.tsx`: this page's content
// depends on the caller's sign-in state, which must never be cached and
// served to a different user. Without this, Next.js may statically
// prerender the page at build time whenever no dynamic API happens to run
// on that particular build (e.g. when Supabase env vars are unset), which
// would freeze whatever branch rendered then for every later request.
export const dynamic = "force-dynamic";

export default async function WebcamDiscoveryPage() {
  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!isSupabaseConfigured) {
    return (
      <PageShell>
        <NoticeCard title="Supabase is not configured yet">
          <p>
            This page needs <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> set
            in <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code> -- copy{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local.example</code> and fill in a real
            Supabase project&apos;s values. No real project exists yet as of T19.1.
          </p>
        </NoticeCard>
      </PageShell>
    );
  }

  let isSignedIn = false;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isSignedIn = Boolean(user);
  } catch (error) {
    logger.error("page.auth_check_failed", { error: errorMessage(error) });
    return (
      <PageShell>
        <NoticeCard title="Could not check sign-in status">
          <p>Something went wrong verifying your session. Try reloading, or sign in again.</p>
        </NoticeCard>
      </PageShell>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell>
        <NoticeCard title="Sign-in required">
          <p>
            Submitting a candidate writes a row to <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">camera_sources</code>{" "}
            attributed to your account (<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">added_by</code>),
            same as a human moderation-queue submission -- sign in first.
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

  return (
    <PageShell>
      <ScaffoldingNotice />
      <AnthropicKeyNotice />
      <DiscoveryForm />
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
            Webcam Candidate Discovery
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Candidate-discovery workflow (T19.1): normalize a candidate URL with an LLM and submit it to the camera
            allowlist as a pending review row. Demo/test route -- not linked from the homepage.
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

function ScaffoldingNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:border-amber-400/30 dark:text-amber-200">
      <p className="font-semibold">There is no &quot;discover for me&quot; button, on purpose.</p>
      <p className="mt-1">
        THREAT_MODEL.md §9 flags Tasks 17-19 as the highest legal exposure in the backlog and gates them on a legal
        review of the scraping/redistribution approach that hasn&apos;t happened yet. This page only ever runs the
        extract-and-submit half of the pipeline against URLs <em>you</em> type in below -- see{" "}
        <code className="rounded bg-amber-500/10 px-1">src/lib/webcam-discovery/discover-candidates.ts</code> for the
        full reasoning. Every submission lands as <code className="rounded bg-amber-500/10 px-1">pending_review</code>{" "}
        and is never auto-published.
      </p>
    </div>
  );
}

function AnthropicKeyNotice() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <p>
        The extraction step calls the Anthropic API and needs a real{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">ANTHROPIC_API_KEY</code> in{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code> to do anything -- without one,
        every candidate below will report a clear &quot;failed&quot; result rather than silently doing nothing.
      </p>
    </div>
  );
}
