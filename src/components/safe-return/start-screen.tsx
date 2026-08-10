"use client";

/**
 * T15.1 (duration selection + start action) and T15.6 (onboarding
 * disclaimer, shown as a required gate before every timer start — see the
 * judgment call noted in `disclaimer-notice.tsx`'s header comment on why
 * "every time" rather than "first time only").
 */

import { useState } from "react";
import type { AlertChannel } from "@/lib/safe-return/alert-channel";
import type { UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import { formatMinutesLabel } from "@/lib/safe-return/format";
import { logger } from "@/lib/safe-return/logger";
import { DisclaimerNotice } from "./disclaimer-notice";
import { RecoveryNotice } from "./recovery-notice";
import { StatusPanel } from "./status-panel";

interface StartScreenProps {
  timer: UseSafeReturnTimerResult;
  alertChannel: AlertChannel;
}

const PRESET_MINUTES = [45, 60, 90];

// Dev-only escape hatch: real dive timers are always minute-granularity, but
// testing the expiry/alarm path shouldn't require sitting through 45+ real
// minutes. Dead-code-eliminated from prod bundles (see safe-return-timer.tsx).
const IS_DEV = process.env.NODE_ENV !== "production";

export function StartScreen({ timer, alertChannel }: StartScreenProps) {
  const [selectedMinutes, setSelectedMinutes] = useState<number>(60);
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [useTestSeconds, setUseTestSeconds] = useState(false);
  const [testSeconds, setTestSeconds] = useState<string>("");
  const [label, setLabel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const effectiveMinutes = useCustom ? Number.parseInt(customMinutes, 10) : selectedMinutes;
  const parsedTestSeconds = Number.parseInt(testSeconds, 10);

  const effectiveDurationMs =
    IS_DEV && useTestSeconds ? parsedTestSeconds * 1000 : effectiveMinutes * 60 * 1000;

  const isValidDuration =
    IS_DEV && useTestSeconds
      ? Number.isFinite(parsedTestSeconds) && parsedTestSeconds > 0 && parsedTestSeconds <= 24 * 60 * 60
      : Number.isFinite(effectiveMinutes) && effectiveMinutes > 0 && effectiveMinutes <= 24 * 60;

  const handleStart = async () => {
    if (!isValidDuration || !acknowledged || isStarting) return;
    setIsStarting(true);
    try {
      // Priming from this tap (a user gesture) is what gives the Web Audio
      // unlock and the Notification permission prompt their best shot at
      // succeeding — see alert-channel.ts's prime() doc comment.
      await alertChannel.prime();
    } catch (err) {
      logger.warn("safe-return.prime-failed-on-start", { error: String(err) });
    } finally {
      timer.start(effectiveDurationMs, label.trim());
      setIsStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Transient by construction: the hook clears the flag as soon as a new
          timer is started, and "Dismiss" clears it on demand — it can't become
          permanent furniture on this screen. */}
      {timer.recoveredFromCorruptState && (
        <RecoveryNotice onDismiss={timer.dismissRecoveryNotice} />
      )}

      <DisclaimerNotice />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Timer length</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESET_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={useTestSeconds}
              onClick={() => {
                setSelectedMinutes(minutes);
                setUseCustom(false);
              }}
              className={`min-h-[44px] rounded-xl border px-3 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                !useCustom && selectedMinutes === minutes
                  ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-400 dark:border-depth-border dark:text-zinc-300 dark:hover:border-depth-3"
              }`}
            >
              {formatMinutesLabel(minutes)}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={useCustom}
            disabled={useTestSeconds}
            onChange={(event) => setUseCustom(event.target.checked)}
            className="h-4 w-4"
          />
          Custom duration
        </label>
        {useCustom && !useTestSeconds && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={24 * 60}
              placeholder="Minutes"
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              className="w-28 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-depth-border dark:text-zinc-100"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">minutes</span>
          </div>
        )}

        {IS_DEV && (
          <>
            <label className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={useTestSeconds}
                onChange={(event) => setUseTestSeconds(event.target.checked)}
                className="h-4 w-4"
              />
              Dev: test duration in seconds
            </label>
            {useTestSeconds && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={24 * 60 * 60}
                  placeholder="Seconds"
                  value={testSeconds}
                  onChange={(event) => setTestSeconds(event.target.value)}
                  className="w-28 rounded-lg border border-amber-400 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-amber-600 dark:text-zinc-100"
                />
                <span className="text-sm text-amber-700 dark:text-amber-400">seconds (dev only)</span>
              </div>
            )}
          </>
        )}

        <label className="mt-2 flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          Dive plan label (optional)
          <input
            type="text"
            placeholder="e.g. La Jolla Cove shore dive"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:border-depth-border dark:text-zinc-100"
          />
        </label>
      </div>

      <label className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        I understand this only alerts me on this device, nobody else is notified, and
        it&apos;s less reliable in the background — I&apos;ve told a real person my dive plan.
      </label>

      {/* The one deliberately-decorative gradient moment on this screen, per
          DESIGN_SYSTEM.md §2.3 — see creative/mockups/safe-return/start.html's
          .btn-primary. */}
      <button
        type="button"
        disabled={!isValidDuration || !acknowledged || isStarting}
        onClick={handleStart}
        className="w-full min-h-[58px] rounded-2xl bg-gradient-dive px-6 py-4 text-base font-semibold text-white shadow-[0_10px_30px_-12px_rgba(131,101,190,0.55)] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isStarting ? "Starting…" : "Start Timer"}
      </button>

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          What&apos;s actually available right now:
        </p>
        <StatusPanel alertChannel={alertChannel} />
      </div>
    </div>
  );
}
