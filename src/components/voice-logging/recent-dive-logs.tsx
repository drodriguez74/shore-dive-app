"use client";

/**
 * Saved dive logs on this device.
 *
 * Not in any mockup — added because a logbook the diver can't read back is
 * a write-only feature, and because it makes the per-field lineage visible
 * after the fact. An entry shows how many fields were left as transcribed
 * versus corrected, which is the only place THREAT_MODEL.md §3's
 * misrecognition risk becomes observable: a diver who finds themselves
 * correcting the depth every single time learns not to trust it, which is
 * exactly the response that finding wants to enable.
 */

import {
  formatDepthFt,
  formatExposureSuit,
  formatRuntimeMinutes,
  formatTankPressure,
  formatWaterTempF,
} from "@/lib/voice-logging/format";
import { useDiveLogEntries } from "@/lib/voice-logging/storage";

export function RecentDiveLogs({ className = "" }: { className?: string }) {
  const entries = useDiveLogEntries();

  return (
    <section className={`rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1 ${className}`}>
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Saved dive logs (this device only)</h2>

      {entries.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">No dive logs saved yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-depth-border">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {entry.site.trim() === "" ? "Unnamed site" : entry.site}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
                  {new Date(entry.loggedAt).toLocaleString()}
                </span>
              </div>

              {entry.buddy.trim() !== "" && (
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">with {entry.buddy}</p>
              )}

              <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                {formatDepthFt(entry.maxDepthFt)} · {formatRuntimeMinutes(entry.runtimeMinutes)} ·{" "}
                {entry.visibility ?? "—"} viz · {entry.current ?? "—"} current
              </p>

              {/*
                Gear and thermal detail on its own line, and only the parts
                actually recorded. The line above shows an em dash for a
                missing value because depth/runtime/viz/current are the
                four every entry is expected to have; these four are
                genuinely optional, so a row of dashes would imply the diver
                skipped something rather than that it never applied.
              */}
              {(() => {
                const gear = [
                  formatTankPressure(entry.tankPressureStartPsi, entry.tankPressureEndPsi),
                  formatWaterTempF(entry.waterTempF),
                  formatExposureSuit(entry.exposureSuit),
                ].filter((value) => value !== "—");

                return gear.length === 0 ? null : (
                  <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{gear.join(" · ")}</p>
                );
              })()}

              {entry.marineLife.length > 0 && (
                <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">{entry.marineLife.join(", ")}</p>
              )}

              {entry.notes.trim() !== "" && (
                <p className="mt-1 text-xs italic text-zinc-500 dark:text-zinc-400">{entry.notes}</p>
              )}

              <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                {entry.entryMethod === "voice"
                  ? `Voice · ${entry.transcribedFields.length} field${entry.transcribedFields.length === 1 ? "" : "s"} as transcribed, ${entry.editedFields.length} corrected`
                  : "Typed in"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
