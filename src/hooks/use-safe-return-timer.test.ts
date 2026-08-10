// @vitest-environment jsdom

/**
 * Behavioral tests for the Safe-Return timer hook.
 *
 * CLAUDE.md names this one of two areas "where a bug has real-world
 * consequences", so these tests deliberately target diver-facing behavior
 * rather than internals: does the alarm fire when it should, does it fire
 * exactly once, does check-in actually stop it, and does corrupted or
 * cross-tab state produce a sane result instead of a false alarm.
 *
 * Two setup notes worth knowing before editing this file:
 *
 * 1. The hook's persisted snapshot lives in *module scope* (`cachedSnapshot`),
 *    so it survives between tests. Rather than `vi.resetModules()` (which would
 *    hand the hook a second copy of React and break `renderHook`), state is
 *    reset by writing localStorage and dispatching a `storage` event — the
 *    hook's own cross-tab listener re-reads from storage, which is a real code
 *    path, not a test-only backdoor. See `seedPersisted()`.
 * 2. The `AlertChannel` is mocked at its interface boundary (it's injectable
 *    for exactly this reason); real Web Audio is never exercised here. See
 *    `alert-channel.test.ts` for that side.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertChannel } from "@/lib/safe-return/alert-channel";
import { useSafeReturnTimer } from "@/hooks/use-safe-return-timer";

/** Mirrors the (unexported) STORAGE_KEY in use-safe-return-timer.ts. */
const STORAGE_KEY = "shore-dive:safe-return-timer:v1";

const NOW = 1_800_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;

interface PersistedShape {
  status?: unknown;
  durationMs?: unknown;
  startedAt?: unknown;
  label?: unknown;
}

function makeAlertChannel() {
  const prime = vi.fn<AlertChannel["prime"]>(async () => {});
  const fire = vi.fn<AlertChannel["fire"]>(async () => {});
  const stop = vi.fn<AlertChannel["stop"]>(() => {});
  const channel: AlertChannel = {
    id: "test-channel",
    label: "Test channel",
    prime,
    fire,
    stop,
    getStatus: () => ({
      channelId: "test-channel",
      label: "Test channel",
      notification: "granted",
      audio: "unlocked",
      vibration: "supported",
    }),
  };
  return { channel, prime, fire, stop };
}

/**
 * Writes localStorage and notifies the hook's module-scope store the same way
 * another browser tab would. Pass a raw string to simulate corrupt storage, or
 * `null` to simulate a first-ever launch.
 */
function seedPersisted(value: PersistedShape | string | null): void {
  if (value === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  }
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

function readPersistedRaw(): PersistedShape | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as PersistedShape);
}

function renderTimer(channel: AlertChannel, strict = false) {
  return renderHook(() => useSafeReturnTimer({ alertChannel: channel }), strict ? { wrapper: StrictMode } : undefined);
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // Logger writes structured JSON to console; silence it but keep it assertable.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  window.localStorage.clear();
  seedPersisted(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSafeReturnTimer — hydration", () => {
  it("starts idle with the default one-hour duration when nothing is persisted", () => {
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("idle");
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
    expect(result.current.startedAt).toBeNull();
    expect(result.current.label).toBe("");
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.isHydrated).toBe(true);
  });

  it("rehydrates an in-progress timer and computes the remaining time from the wall clock", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: NOW - 10 * 60 * 1000, label: "Blue Heron" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("running");
    expect(result.current.label).toBe("Blue Heron");
    expect(result.current.remainingMs).toBe(50 * 60 * 1000);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("useSafeReturnTimer — expiry", () => {
  it("fires the alert exactly once when a live countdown reaches zero", () => {
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.start(60_000, "Lauderdale-by-the-Sea"));
    expect(result.current.status).toBe("running");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("expired");
    expect(result.current.remainingMs).toBe(0);
    expect(readPersistedRaw()?.status).toBe("expired");
  });

  it("does not re-fire on subsequent re-renders or further ticks (firedRef guard)", () => {
    const { channel, fire } = makeAlertChannel();
    const { result, rerender } = renderTimer(channel);

    act(() => result.current.start(1_000));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fire).toHaveBeenCalledTimes(1);

    act(() => rerender());
    act(() => rerender());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires once even under StrictMode's double-invoked effects", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: NOW - 2 * ONE_HOUR_MS, label: "" });
    const { channel, fire } = makeAlertChannel();
    renderTimer(channel, true);

    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires immediately on reopen when expiry already passed while backgrounded", () => {
    // The app was closed/backgrounded through the whole countdown: nothing ran
    // to flip the status, so persisted state is still "running" with a start
    // time two hours in the past. This is the documented honest-failure path.
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: NOW - 2 * ONE_HOUR_MS, label: "Datura" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("expired");
    expect(readPersistedRaw()?.status).toBe("expired");
  });

  it("names the dive in the alert body when a label was set", () => {
    seedPersisted({ status: "running", durationMs: 1_000, startedAt: NOW - 5_000, label: "Blue Heron Bridge" });
    const { channel, fire } = makeAlertChannel();
    renderTimer(channel);

    const context = fire.mock.calls[0][0];
    expect(context.title).toBe("Safe-Return timer expired");
    expect(context.body).toContain("Blue Heron Bridge");
    expect(context.timestamp).toBe(NOW);
  });

  it("falls back to generic alert copy when no label was set", () => {
    seedPersisted({ status: "running", durationMs: 1_000, startedAt: NOW - 5_000, label: "" });
    const { channel, fire } = makeAlertChannel();
    renderTimer(channel);

    expect(fire.mock.calls[0][0].body).toBe("You didn't check in. If you're safe, open the app and check in.");
  });

  it("logs, and does not throw, when the alert channel itself fails to fire", async () => {
    seedPersisted({ status: "running", durationMs: 1_000, startedAt: NOW - 5_000, label: "" });
    const { channel, fire } = makeAlertChannel();
    fire.mockRejectedValueOnce(new Error("notification blocked"));

    const { result } = renderTimer(channel);
    await act(async () => {});

    // The state transition still happened even though the alarm failed — the
    // UI must be able to show "expired" regardless of the channel's fate.
    expect(result.current.status).toBe("expired");
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain("safe-return.alert-fire-failed");
  });
});

describe("useSafeReturnTimer — transitions", () => {
  it("checkIn() stops the alarm and moves to checked-in", () => {
    seedPersisted({ status: "expired", durationMs: ONE_HOUR_MS, startedAt: NOW - 2 * ONE_HOUR_MS, label: "x" });
    const { channel, stop } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.checkIn());

    expect(stop).toHaveBeenCalled();
    expect(result.current.status).toBe("checked-in");
    expect(readPersistedRaw()?.status).toBe("checked-in");
  });

  it("silenceAlarm() stops the sound without claiming the diver is safe", () => {
    seedPersisted({ status: "expired", durationMs: ONE_HOUR_MS, startedAt: NOW - 2 * ONE_HOUR_MS, label: "x" });
    const { channel, stop } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.silenceAlarm());

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("expired");
  });

  it("reset() returns to idle defaults and clears storage state", () => {
    seedPersisted({ status: "expired", durationMs: 15 * 60 * 1000, startedAt: NOW - ONE_HOUR_MS, label: "x" });
    const { channel, stop } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.reset());

    expect(stop).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
    expect(result.current.startedAt).toBeNull();
    expect(result.current.label).toBe("");
    expect(readPersistedRaw()).toEqual({ status: "idle", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
  });

  it("clears the fired guard so a timer started after a reset can fire again", () => {
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.start(1_000, "first dive"));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(fire).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    act(() => result.current.start(1_000, "second dive"));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire.mock.calls[1][0].body).toContain("second dive");
  });

  it("start() silences any in-progress alarm and persists the new running window", () => {
    const { channel, stop } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.start(45 * 60 * 1000, "Deerfield"));

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("running");
    expect(result.current.remainingMs).toBe(45 * 60 * 1000);
    expect(readPersistedRaw()).toEqual({
      status: "running",
      durationMs: 45 * 60 * 1000,
      startedAt: NOW,
      label: "Deerfield",
    });
  });
});

describe("useSafeReturnTimer — persistence", () => {
  it("round-trips a running timer through localStorage to a fresh mount", () => {
    const first = makeAlertChannel();
    const { result, unmount } = renderTimer(first.channel);
    act(() => result.current.start(30 * 60 * 1000, "Boynton Ledge"));
    unmount();

    // Simulate a reload: same storage, brand-new hook instance.
    vi.setSystemTime(NOW + 10 * 60 * 1000);
    const second = makeAlertChannel();
    const { result: reloaded } = renderTimer(second.channel);

    expect(reloaded.current.status).toBe("running");
    expect(reloaded.current.label).toBe("Boynton Ledge");
    expect(reloaded.current.startedAt).toBe(NOW);
    expect(reloaded.current.remainingMs).toBe(20 * 60 * 1000);
    expect(second.fire).not.toHaveBeenCalled();
  });

  it("falls back to the idle default on malformed JSON rather than throwing", () => {
    seedPersisted("{ this is not json");
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("idle");
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
    expect(fire).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain("safe-return.storage-read-failed");
  });

  it("falls back to the idle default on an unknown status value", () => {
    seedPersisted({ status: "surfacing", durationMs: 1_000, startedAt: NOW, label: "" });
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("idle");
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
  });

  it("falls back to the idle default when durationMs is not a number", () => {
    seedPersisted({ status: "running", durationMs: "3600000", startedAt: NOW, label: "" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("idle");
    expect(fire).not.toHaveBeenCalled();
  });

  it("coerces a non-numeric startedAt and a non-string label to their defaults", () => {
    seedPersisted({ status: "checked-in", durationMs: 1_000, startedAt: "yesterday", label: { a: 1 } });
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(result.current.status).toBe("checked-in");
    expect(result.current.startedAt).toBeNull();
    expect(result.current.label).toBe("");
  });

  it("keeps running in-memory when localStorage writes are blocked (private mode / quota)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => result.current.start(20 * 60 * 1000, "Pompano"));

    expect(result.current.status).toBe("running");
    expect(result.current.remainingMs).toBe(20 * 60 * 1000);
    expect(String(warnSpy.mock.calls[0][0])).toContain("safe-return.storage-write-failed");
    setItem.mockRestore();
  });
});

describe("useSafeReturnTimer — corrupt running state", () => {
  /**
   * T21.15 found this and pinned the then-current behavior instead of changing
   * it: a persisted `status: "running"` with `startedAt: null` passed
   * `readPersisted()`'s validation (it type-checked `startedAt` but never
   * rejected the null-while-running *combination*), `remainingMs` short-
   * circuited to 0, and the expiry effect read that as "the countdown is over"
   * and fired the alarm on load — a false "you didn't check in" alarm for a
   * dive the diver never started. Flipping it was left as a founder call on a
   * safety-critical path.
   *
   * **That call was made (T21.19): reset to idle, and say so.** The reasoning,
   * kept here because it's what these assertions are actually protecting:
   * with no usable `startedAt` there is no recoverable timer at all, so firing
   * isn't failing safe — it asserts something specific and false ("your timer
   * expired") when the truth is "we lost your timer state", and false alarms
   * are how a diver learns to distrust the one alarm that matters. Resetting
   * *silently* was rejected too: a diver who really had a timer running would
   * see a normal idle screen and assume they were still covered, trading a
   * false alarm for a false sense of safety. Hence: no alarm, idle status, and
   * a visible non-alarm notice (`recoveredFromCorruptState`).
   */
  it("resets to idle without firing when status is running but startedAt is null", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "Blue Heron" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(fire).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.startedAt).toBeNull();
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.recoveredFromCorruptState).toBe(true);
  });

  it("resets to idle without firing when startedAt is a non-finite number", () => {
    // NaN survives JSON as `null`, but a non-finite value can reach the parsed
    // object via a hand-edited or half-written record; before the fix it made
    // `remainingMs` NaN, which is also `> 0 === false`, i.e. it fired too.
    seedPersisted(
      `{"status":"running","durationMs":${ONE_HOUR_MS},"startedAt":1e999,"label":""}`,
    );
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(fire).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.recoveredFromCorruptState).toBe(true);
  });

  it("resets to idle without firing when a running timer has a non-positive duration", () => {
    // Same class of unrecoverable state: a zero/negative window is already
    // "over" the instant it's read, so it would fire on load for a dive that
    // was never really scheduled.
    seedPersisted({ status: "running", durationMs: 0, startedAt: NOW, label: "" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    expect(fire).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.durationMs).toBe(ONE_HOUR_MS);
    expect(result.current.recoveredFromCorruptState).toBe(true);
  });

  it("logs the recovery with the reason so a field failure is debuggable", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
    const { channel } = makeAlertChannel();
    renderTimer(channel);

    const logged = warnSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(logged).toContain("safe-return.corrupt-running-state-recovered");
    expect(logged).toContain("missing-started-at");
  });

  it("persists the reset so the unrestorable record can't be read again", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
    const { channel } = makeAlertChannel();
    renderTimer(channel);

    expect(readPersistedRaw()).toEqual({
      status: "idle",
      durationMs: ONE_HOUR_MS,
      startedAt: null,
      label: "",
    });
  });

  it("does not leave the notice up: dismissing clears it", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);
    expect(result.current.recoveredFromCorruptState).toBe(true);

    act(() => result.current.dismissRecoveryNotice());

    expect(result.current.recoveredFromCorruptState).toBe(false);
    expect(result.current.status).toBe("idle");
  });

  it("clears the notice once a new timer is started", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);
    expect(result.current.recoveredFromCorruptState).toBe(true);

    act(() => result.current.start(30 * 60 * 1000, "Datura"));

    expect(result.current.recoveredFromCorruptState).toBe(false);
    expect(result.current.status).toBe("running");
    expect(result.current.remainingMs).toBe(30 * 60 * 1000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("leaves the notice unset for a normal restore, and for a genuinely expired timer", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: NOW - 2 * ONE_HOUR_MS, label: "" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel);

    // The real backgrounded-through-expiry path is untouched: still fires.
    expect(fire).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("expired");
    expect(result.current.recoveredFromCorruptState).toBe(false);
  });

  it("does not fire under StrictMode's double-invoked effects either", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: null, label: "" });
    const { channel, fire } = makeAlertChannel();
    const { result } = renderTimer(channel, true);

    expect(fire).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.recoveredFromCorruptState).toBe(true);
  });
});

describe("useSafeReturnTimer — cross-tab sync", () => {
  it("picks up a check-in performed in another tab", () => {
    seedPersisted({ status: "running", durationMs: ONE_HOUR_MS, startedAt: NOW, label: "Jupiter" });
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);
    expect(result.current.status).toBe("running");

    act(() => {
      seedPersisted({ status: "checked-in", durationMs: ONE_HOUR_MS, startedAt: NOW, label: "Jupiter" });
    });

    expect(result.current.status).toBe("checked-in");
  });

  it("picks up a timer started in another tab", () => {
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);
    expect(result.current.status).toBe("idle");

    act(() => {
      seedPersisted({ status: "running", durationMs: 30 * 60 * 1000, startedAt: NOW, label: "Hollywood Beach" });
    });

    expect(result.current.status).toBe("running");
    expect(result.current.remainingMs).toBe(30 * 60 * 1000);
    expect(result.current.label).toBe("Hollywood Beach");
  });

  it("ignores storage events for unrelated keys", () => {
    const { channel } = makeAlertChannel();
    const { result } = renderTimer(channel);

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ status: "running", durationMs: 1_000, startedAt: NOW, label: "" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "some-other-app:state" }));
    });

    expect(result.current.status).toBe("idle");
  });
});
