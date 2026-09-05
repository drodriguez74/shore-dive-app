"use client";

/**
 * Demo/test route for the post-dive logging surfaces (→ TASKS.md T14 demo
 * requirement, plus the Frictionless Voice Logging pillar). Mirrors how the
 * Safe-Return timer got its own `/safe-return` route: there's no real
 * end-to-end dive-plan flow yet to trigger this naturally, so this page
 * lets you simulate the two trigger signals (a Safe-Return status
 * transition, or a stubbed dive-plan check-in ending) and watch the gated
 * trigger logic decide whether to show the prompt — plus manual entry
 * points that always work, independent of the auto-prompt setting.
 *
 * ## Two distinct features live here, deliberately not merged
 *
 * `PostDivePrompt` (T14) is the single-tap conditions card: visibility,
 * current, one marine-life yes/no. `VoiceLogFlowView` is the voice-logging
 * pillar: recording, on-device transcription, the mandatory confirm/edit
 * step, and the full structured entry (depth, runtime, sightings, notes).
 * They are different scopes, and `post-dive-prompt/types.ts` says so in its
 * own header.
 *
 * `creative/flows/voice-logging.md` renders them as one surface — the chips
 * card with a voice-offer section beneath it — and this page reproduces
 * that stacking order, with the voice offer directly under the prompt when
 * it fires. It does **not** reach into `post-dive-prompt.tsx` to nest the
 * offer inside that card: this workstream's file scope stops at the
 * voice-logging modules, and a shared component edited from two parallel
 * worktrees is exactly how a fan-out round produces merge conflicts. The
 * visual difference is one card border; the merge risk was not worth it.
 * Noted so a later pass can nest it properly in a single-owner change.
 *
 * Deliberately not linked from the homepage — reachable directly at
 * /post-dive, the same convention as `/media-demo` and `/safe-return`.
 */

import Link from "next/link";
import { useState } from "react";
import type { SafeReturnStatus } from "@/hooks/use-safe-return-timer";
import { usePostDivePromptTrigger, type DivePlanCheckInState } from "@/hooks/use-post-dive-prompt-trigger";
import { PostDivePrompt, usePostDiveConditionLogs } from "@/components/post-dive-prompt";
import { useVoiceLogFlow } from "@/hooks/use-voice-log-flow";
import { RecentDiveLogs, VoiceLogFlowView, VoiceLoggingSettingsPanel } from "@/components/voice-logging";

const SAFE_RETURN_STATUSES: { value: SafeReturnStatus; label: string; description: string }[] = [
  { value: "idle", label: "Idle", description: "No timer running." },
  { value: "running", label: "Running", description: "Countdown started before entering the water." },
  { value: "checked-in", label: "Checked in", description: "Explicit confirmation the diver is back safely." },
  { value: "expired", label: "Expired", description: "Missed check-in — deliberately does NOT trigger this prompt." },
];

const DEMO_SITE_ID = "demo-site-la-jolla-cove";
const DEMO_SITE_NAME = "La Jolla Cove";

export default function PostDivePage() {
  const [safeReturnStatus, setSafeReturnStatus] = useState<SafeReturnStatus>("idle");
  const [checkInState, setCheckInState] = useState<DivePlanCheckInState>({
    isActive: false,
    siteId: null,
    checkedInAt: null,
  });

  const trigger = usePostDivePromptTrigger({ safeReturnStatus, checkInState });
  const logs = usePostDiveConditionLogs();

  // The page owns the voice-logging flow rather than letting `VoiceLogFlow`
  // create its own, so the settings panel's "Log a dive now" opens this
  // same form instance instead of a second, disconnected one.
  const voiceFlow = useVoiceLogFlow({ siteId: DEMO_SITE_ID, siteName: DEMO_SITE_NAME });

  const startDivePlan = () => {
    setCheckInState({ isActive: true, siteId: DEMO_SITE_ID, checkedInAt: null });
  };

  const endDivePlan = () => {
    setCheckInState((prev) => ({ ...prev, isActive: false, checkedInAt: Date.now() }));
  };

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            ← Shore Dive
          </Link>
          <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Post-Dive Logging
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Two surfaces: a single-tap conditions prompt gated on an active dive-plan check-in state (never bare GPS
            proximity), and the full voice-logged dive entry. This page is a demo/test harness — it simulates the two
            trigger signals since there&apos;s no real dive-plan flow wired up yet.
          </p>
        </div>

        <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <div>
            <h2 className="font-display text-base font-semibold text-black dark:text-zinc-50">Log the full dive</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Depth, runtime, marine life, and conditions — spoken or typed. Always available, regardless of the
              auto-prompt setting.
            </p>
          </div>
          <VoiceLogFlowView flow={voiceFlow} siteName={DEMO_SITE_NAME} />
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Quick conditions prompt</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            The T14 micro-prompt — always available here, regardless of the auto-prompt setting.
          </p>
          <button
            type="button"
            onClick={trigger.showManually}
            className="mt-3 min-h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-depth-border dark:text-zinc-300 dark:hover:bg-depth-2"
          >
            Log conditions now
          </button>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Simulate: Safe-Return timer status
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Only the <code className="rounded bg-zinc-100 px-1 dark:bg-depth-2">running → checked-in</code>{" "}
            transition auto-fires the prompt. Try &quot;Expired&quot; to confirm it deliberately does not.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SAFE_RETURN_STATUSES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.description}
                onClick={() => setSafeReturnStatus(opt.value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  safeReturnStatus === opt.value
                    ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/15 dark:text-sky-300"
                    : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-depth-border dark:text-zinc-400 dark:hover:border-zinc-500"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Current: <span className="font-medium text-zinc-700 dark:text-zinc-300">{safeReturnStatus}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Simulate: dive-plan check-in state
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Stands in for the future real dive-plan model. Ending an active check-in auto-fires the prompt.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startDivePlan}
              disabled={checkInState.isActive}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-depth-border dark:text-zinc-400 dark:hover:border-zinc-500"
            >
              Start check-in
            </button>
            <button
              type="button"
              onClick={endDivePlan}
              disabled={!checkInState.isActive}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-depth-border dark:text-zinc-400 dark:hover:border-zinc-500"
            >
              End check-in
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Current: <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {checkInState.isActive ? `active (${checkInState.siteId})` : "inactive"}
            </span>
          </p>
        </section>

        {trigger.visible && (
          <PostDivePrompt
            source={trigger.source ?? "manual"}
            siteId={checkInState.siteId}
            onDismiss={trigger.dismiss}
            onLogged={trigger.markLogged}
          />
        )}

        <RecentDiveLogs />

        <VoiceLoggingSettingsPanel onLogDiveNow={voiceFlow.startManual} />

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Recent quick-conditions logs (this device only)
          </h2>
          {logs.length === 0 ? (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">No logs saved yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-depth-border dark:text-zinc-400"
                >
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {new Date(log.loggedAt).toLocaleString()}
                  </span>{" "}
                  · visibility: {log.visibility ?? "—"} · current: {log.current ?? "—"} · marine life:{" "}
                  {log.sawNotableMarineLife === null ? "—" : log.sawNotableMarineLife ? "yes" : "no"} · source:{" "}
                  {log.source}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
