"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  backUpDiveLogs,
  fetchBackedUpDiveLogs,
  isBackupEnabled,
  setBackupEnabled,
  type BackupFailureReason,
  type DiveLogBackupClient,
} from "@/lib/dive-logs/backup";
import { createClient } from "@/lib/supabase/client";
import { mergeDiveLogEntries, useDiveLogEntries } from "@/lib/voice-logging/storage";

/**
 * Opt-in account backup for the dive logs on this device. Off by default;
 * when on, entries are copied to the diver's account after each change.
 * Status is always stated as what actually happened, never assumed.
 */

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "backed-up"; count: number; at: Date }
  | { kind: "restored"; added: number }
  | { kind: "error"; reason: BackupFailureReason };

const FAILURE_MESSAGE: Record<BackupFailureReason, string> = {
  "signed-out": "You're signed out, so nothing was backed up.",
  unavailable: "Account backup isn't set up on this server yet. Your logs are still only on this device.",
  failed: "Backup didn't go through — your logs are still safe on this device. It will retry next time.",
};

function browserClient(): DiveLogBackupClient | null {
  try {
    return createClient() as unknown as DiveLogBackupClient;
  } catch {
    return null;
  }
}

export function DiveLogBackupPanel({ className = "" }: { className?: string }) {
  const entries = useDiveLogEntries();
  const client = useMemo(() => browserClient(), []);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    const check = client
      ? client.auth.getUser().then(({ data }) => data.user !== null)
      : Promise.resolve(false);
    void check
      .catch(() => false)
      .then((isSignedIn) => {
        if (cancelled) return;
        setSignedIn(isSignedIn);
        setEnabled(isBackupEnabled());
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Back up whenever the entries change while backup is on.
  useEffect(() => {
    if (!client || !enabled || !signedIn || entries.length === 0) return;
    let cancelled = false;
    void backUpDiveLogs(client, entries).then((result) => {
      if (cancelled) return;
      setStatus(
        result.ok ? { kind: "backed-up", count: result.count, at: new Date() } : { kind: "error", reason: result.reason },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, enabled, signedIn, entries]);

  async function handleRestore() {
    if (!client) return;
    setStatus({ kind: "working" });
    const result = await fetchBackedUpDiveLogs(client);
    setStatus(
      result.ok ? { kind: "restored", added: mergeDiveLogEntries(result.entries) } : { kind: "error", reason: result.reason },
    );
  }

  function handleToggle(next: boolean) {
    setBackupEnabled(next);
    setEnabled(next);
    setStatus({ kind: "idle" });
  }

  if (signedIn === null) return null;

  return (
    <section
      className={`rounded-2xl border border-zinc-200 bg-white p-4 text-sm dark:border-depth-border dark:bg-depth-1 ${className}`}
    >
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Back up dive logs to your account</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Dive logs are stored only in this browser and are lost if its data is cleared. Backup keeps a private copy
        in your account that only you can read. Your voice transcript is never uploaded; the buddy name and notes
        you typed are.
      </p>

      {!signedIn ? (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-sky-700 underline underline-offset-2 dark:text-sky-400">
            Sign in
          </Link>{" "}
          to turn on backup.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => handleToggle(event.target.checked)}
              className="h-4 w-4"
            />
            Back up this device&apos;s dive logs
          </label>
          <button
            type="button"
            onClick={handleRestore}
            disabled={status.kind === "working"}
            className="self-start text-xs font-medium text-sky-700 underline underline-offset-2 disabled:opacity-60 dark:text-sky-400"
          >
            Restore logs from my account
          </button>
        </div>
      )}

      <p role="status" className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        {status.kind === "working" && "Working…"}
        {status.kind === "backed-up" &&
          `${status.count} log${status.count === 1 ? "" : "s"} backed up as of ${status.at.toLocaleTimeString()}.`}
        {status.kind === "restored" &&
          (status.added === 0
            ? "Nothing to restore — this device already has everything in your account."
            : `Restored ${status.added} log${status.added === 1 ? "" : "s"} to this device.`)}
        {status.kind === "error" && <span className="text-amber-700 dark:text-amber-400">{FAILURE_MESSAGE[status.reason]}</span>}
      </p>
    </section>
  );
}
