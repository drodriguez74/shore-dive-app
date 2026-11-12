"use client";

import { useEffect } from "react";
import { refreshStaleSavedSites } from "@/lib/offline/prefetch-site";

/**
 * Refreshes stale saved sites whenever the app is opened (or regains a
 * connection). Renders nothing. Best-effort by design — see
 * `refreshStaleSavedSites`.
 */
export function OfflineAutoRefresh() {
  useEffect(() => {
    const run = () => void refreshStaleSavedSites();
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, []);

  return null;
}
