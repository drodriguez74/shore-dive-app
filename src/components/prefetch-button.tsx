"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FreshnessBadge } from "@/components/freshness-badge";
import {
  getCachedSite,
  OFFLINE_CACHE_CHANGED_EVENT,
  prefetchSite,
  type PrefetchFailureReason,
} from "@/lib/offline/prefetch-site";

/**
 * Manual "Prefetch Now" trigger (T12.6). Background sync is opportunistic at
 * best on the web (plan.md Resolved Decision 3), so this button is the
 * reliable path. It reports freshness ("saved as of"), never a bare
 * "cached" flag, and nothing is saved unless the bundle verified.
 */

export interface PrefetchButtonProps {
  siteId: string;
  className?: string;
}

type Status = "idle" | "loading" | "error";

export const PREFETCH_FAILURE_MESSAGE: Record<PrefetchFailureReason, string> = {
  offline: "You're offline — connect to save this site. Nothing new was saved.",
  "not-configured": "Offline saving isn't set up on this server yet. Nothing was saved.",
  "not-found": "This site no longer exists, so there's nothing to save.",
  "rate-limited": "Too many saves in a short time. Nothing new was saved — wait a minute and try again.",
  network: "Couldn't reach the server. Nothing new was saved — try again with a connection.",
  "invalid-bundle": "The server sent data we couldn't read. Nothing was saved.",
  "verification-failed": "The download failed its integrity check, so it was discarded. Try again.",
  storage: "Couldn't save to this device — storage may be full or blocked (e.g. private browsing).",
};

export function PrefetchButton({ siteId, className = "" }: PrefetchButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<PrefetchFailureReason | null>(null);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void getCachedSite(siteId).then((cached) => {
        if (!cancelled) setCachedAt(cached?.cachedAt ?? null);
      });
    };
    read();
    // Another component (e.g. add-to-dive-plan) may save or remove this site.
    window.addEventListener(OFFLINE_CACHE_CHANGED_EVENT, read);
    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_CACHE_CHANGED_EVENT, read);
    };
  }, [siteId]);

  async function handlePrefetch() {
    setStatus("loading");
    setFailure(null);
    const result = await prefetchSite(siteId);
    if (result.ok) {
      setCachedAt(result.cachedAt);
      setStatus("idle");
    } else {
      setFailure(result.reason);
      setStatus("error");
    }
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handlePrefetch}
          disabled={status === "loading"}
          className="rounded-md bg-sky-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "loading" ? "Saving…" : cachedAt ? "Refresh offline copy" : "Prefetch Now"}
        </button>
        {cachedAt && <FreshnessBadge cachedAt={cachedAt} />}
      </div>
      {failure && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {PREFETCH_FAILURE_MESSAGE[failure]}
          {cachedAt && " Your earlier saved copy is still on this device."}
        </p>
      )}
      {cachedAt && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Site details and hazard reports are saved on this device as of the time shown — anything reported
          later isn&apos;t included, and map tiles aren&apos;t guaranteed offline. Stale copies refresh when you
          open the app with a connection, never in the background.{" "}
          <Link href="/offline" className="font-medium underline underline-offset-2 hover:no-underline">
            View saved sites
          </Link>
        </p>
      )}
    </div>
  );
}
