"use client";

/**
 * Shows the alert channel's real, current capability — not a static "this
 * will work" claim. Per CLAUDE.md's engineering standard, a UI must never
 * imply a guarantee the system can't back, so when notification permission
 * is denied or audio hasn't been unlocked yet, this says so plainly instead
 * of failing silently.
 *
 * Reads status via useSyncExternalStore rather than a mount effect calling
 * setState: `getStatus()` is SSR-safe (each underlying check guards for a
 * missing window/Notification/navigator and returns "unsupported"), but a
 * plain useState initializer still re-runs fresh on the client during
 * hydration — so if the browser's real capability differs from the server's
 * deterministic "unsupported" fallback, the hydration render's text can
 * mismatch what the server sent. useSyncExternalStore's server/client
 * snapshot split is exactly the primitive that avoids that, on top of also
 * side-stepping react-hooks/set-state-in-effect.
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { AlertChannel, AlertChannelStatus } from "@/lib/safe-return/alert-channel";

interface StatusPanelProps {
  alertChannel: AlertChannel;
  className?: string;
}

const NOTIFICATION_LABEL: Record<AlertChannelStatus["notification"], string> = {
  granted: "notifications: permitted",
  denied: "notifications: blocked — enable in browser settings to use this",
  default: "notifications: not yet permitted",
  unsupported: "notifications: not supported in this browser",
};

const AUDIO_LABEL: Record<AlertChannelStatus["audio"], string> = {
  unlocked: "alarm sound: ready",
  locked: "alarm sound: not yet unlocked — starting the timer will try again",
  unsupported: "alarm sound: not supported in this browser",
};

const VIBRATION_LABEL: Record<AlertChannelStatus["vibration"], string> = {
  supported: "vibration: available",
  unsupported: "vibration: not available (expected on iPhone)",
};

function statusEqual(a: AlertChannelStatus, b: AlertChannelStatus): boolean {
  return a.notification === b.notification && a.audio === b.audio && a.vibration === b.vibration;
}

/**
 * Wraps an AlertChannel's getStatus() (a plain, non-cached read — a fresh
 * object every call) as a useSyncExternalStore-compatible store. A cached
 * reference is returned when the shallow contents haven't actually changed,
 * since useSyncExternalStore requires getSnapshot to be referentially
 * stable when nothing changed (otherwise: infinite re-render).
 */
function useAlertChannelStatus(alertChannel: AlertChannel): AlertChannelStatus {
  const cacheRef = useRef<AlertChannelStatus | null>(null);

  const getSnapshot = useCallback((): AlertChannelStatus => {
    const next = alertChannel.getStatus();
    const prev = cacheRef.current;
    if (prev && statusEqual(prev, next)) return prev;
    cacheRef.current = next;
    return next;
  }, [alertChannel]);

  // getStatus() already guards every browser API it touches, so calling it
  // during server rendering is safe and deterministic (all "unsupported").
  const getServerSnapshot = useCallback((): AlertChannelStatus => alertChannel.getStatus(), [alertChannel]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    // Notification permission can change asynchronously outside our control
    // (the user answers a browser prompt), and there's no reliably
    // cross-browser change event for it — so we poll lightly rather than
    // assume a one-time read stays accurate.
    const id = window.setInterval(onStoreChange, 2000);
    return () => window.clearInterval(id);
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function StatusPanel({ alertChannel, className = "" }: StatusPanelProps) {
  const status = useAlertChannelStatus(alertChannel);

  return (
    <ul className={`space-y-1 text-xs text-zinc-600 dark:text-zinc-400 ${className}`}>
      <li>{NOTIFICATION_LABEL[status.notification]}</li>
      <li>{AUDIO_LABEL[status.audio]}</li>
      <li>{VIBRATION_LABEL[status.vibration]}</li>
    </ul>
  );
}
