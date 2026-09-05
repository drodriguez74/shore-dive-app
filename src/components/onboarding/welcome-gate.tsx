"use client";

import Link from "next/link";
import { useHasSeenWelcome } from "@/lib/onboarding/preferences";

/**
 * First-run Welcome hero (`creative/mockups/onboarding/01-welcome.html`,
 * `creative/flows/onboarding.md`) — closes the UX audit's #1 root-cause
 * finding (`TASKS.md` T25): the app had no pitch anywhere, a cold visitor
 * landed directly on functional map/list UI with zero explanation of what
 * it is, who it's for, or its two honest safety/offline limits.
 *
 * A pure additive overlay, not a route or a gate on the real homepage: the
 * server always renders the normal homepage underneath unchanged (see
 * `page.tsx`), and this appears on top only once hydration confirms a
 * genuine first-time, signed-out visitor — the same "server renders the
 * safe default, client reconciles after hydration" shape
 * `explorer-preferences.ts`/`use-geolocation.ts` already established, so
 * there's no new hydration-mismatch risk and zero change to the existing
 * homepage's SSR data-fetch path.
 *
 * Deliberate adaptation from the mockup: the mockup's only CTA is "Get
 * started" → sign in, with no visible skip path. This app's own
 * architecture treats anonymous map browsing as fully first-class (public
 * RLS read model) — a welcome screen with no way out except signing in
 * would be a real regression for that, so a "Browse without signing in"
 * secondary action was added. Both actions dismiss the overlay for good
 * (the point is a one-time pitch, not a repeated gate); only "Get started"
 * also continues to `/login`.
 */

const MaskIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3 9c0-2.8 2.6-5 6-5h6c3.4 0 6 2.2 6 5v2c0 4-3 8-9 8s-9-4-9-8V9Z" />
    <circle cx="9" cy="10.5" r="2.1" />
    <circle cx="15" cy="10.5" r="2.1" />
    <path d="M11 10.5h2" />
  </svg>
);

const HeartIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 21s-7-5.686-7-11a7 7 0 1 1 14 0c0 5.314-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

const HonestyIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export interface WelcomeGateProps {
  isSignedIn: boolean;
}

export function WelcomeGate({ isSignedIn }: WelcomeGateProps) {
  const { hasSeenWelcome, isHydrated, markWelcomeSeen } = useHasSeenWelcome();

  if (!isHydrated || isSignedIn || hasSeenWelcome) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-depth-0"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Shore Dive"
    >
      {/* `my-auto` centers this as a block on a viewport taller than the
          content (any real desktop/tablet/large-phone width — the source
          mockup assumed a fixed 844px-tall phone screen and never had to
          solve for this) instead of the content stretching full-height with
          a spacer shoving the CTA to the very bottom, which on a tall
          viewport left a large dead gap between the fact cards and the
          buttons. `overflow-y-auto` on the parent still lets this scroll
          normally on a short viewport where content exceeds it. */}
      <div className="mx-auto my-auto flex w-full max-w-md flex-col text-zinc-50">
        {/* Hero — the one deliberately decorative Dive Gradient moment, per
            DESIGN_SYSTEM.md §2.3 ("a splash/hero moment in onboarding, once,
            at first-run"). */}
        <div className="relative overflow-hidden bg-gradient-dive px-7 pb-10 pt-16">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 0%, transparent 0%, transparent 45%, var(--depth-0) 100%)",
            }}
          />
          <div className="relative motion-safe:animate-[shore-dive-rise_500ms_ease-out]">
            <div className="mb-[22px] flex h-14 w-14 items-center justify-center rounded-2xl bg-black/25 backdrop-blur-sm">
              <MaskIcon className="h-[30px] w-[30px] stroke-white" />
            </div>
            <h1 className="font-display m-0 text-[30px] font-semibold leading-[1.15] tracking-tight text-white">
              Shore Dive
            </h1>
            <p className="mt-2 max-w-[30ch] text-[15px] leading-[1.5] text-white/90">
              Find hyper-local shore-dive sites, and get back safe.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-[22px] px-6 py-7">
          <p className="m-0 text-[15px] leading-[1.6] text-[#cdd6ea]">
            A map of real shore-entry dive sites — condition data, access notes, and an offline cache so
            you&apos;re not stuck without a signal at the water&apos;s edge. Built and run by one person, for
            the dive community.
          </p>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3 rounded-[14px] border border-depth-border bg-depth-1 p-3.5">
              <HeartIcon className="mt-px h-5 w-5 shrink-0 stroke-sky-400" />
              <div>
                <h2 className="m-0 mb-[3px] text-[13.5px] font-semibold text-[#f2f5fb]">
                  Free, no ads, no subscription
                </h2>
                <p className="m-0 text-[13px] leading-[1.5] text-[#a7b2c9]">
                  Nothing here is monetized. No account tier, no upsell — this stays that way.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-[14px] border border-depth-border bg-depth-1 p-3.5">
              <HonestyIcon className="mt-px h-5 w-5 shrink-0 stroke-amber-400" />
              <div>
                <h2 className="m-0 mb-[3px] text-[13.5px] font-semibold text-[#f2f5fb]">
                  Two honest limits, up front
                </h2>
                <p className="m-0 text-[13px] leading-[1.5] text-[#a7b2c9]">
                  The Safe-Return timer only alerts this device — no one else is notified. Offline caching is
                  best-effort, not guaranteed. More on both later.
                </p>
              </div>
            </div>
          </div>

          <Link
            href="/login"
            onClick={markWelcomeSeen}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-sky-500 text-[15.5px] font-semibold text-[#051019] transition hover:bg-sky-400"
          >
            Get started
            <ArrowIcon />
          </Link>
          <button
            type="button"
            onClick={markWelcomeSeen}
            className="min-h-[44px] text-center text-[13px] font-medium text-[#9aa5bd] underline underline-offset-2 hover:text-zinc-300"
          >
            Browse the map without signing in
          </button>
          <p className="m-0 text-center text-[11.5px] leading-[1.5] text-zinc-500">
            Next: sign in with Google. That&apos;s the only account step.
          </p>
        </div>
      </div>
    </div>
  );
}
