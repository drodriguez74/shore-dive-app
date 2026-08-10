/**
 * Alert-channel abstraction for the Safe-Return timer.
 *
 * v1 (this file) ships exactly one channel: `LocalAlarmChannel`, which alerts
 * only on this device (Notification API + Web Audio alarm tone + Vibration
 * API where supported). Per plan.md's Resolved Decision 1 and THREAT_MODEL.md
 * §0.1/§7, that is a deliberate, disclosed scope limit for v1 — no emergency
 * contacts, no push, no SMS. The `AlertChannel` interface exists so a future
 * `PushAlertChannel` (Web Push to contacts who've installed the app) or
 * `SmsAlertChannel` (once there's budget — see plan.md's funding priority
 * order) can be added later without changing the timer hook's core logic:
 * the hook only ever calls `prime()`, `fire()`, `stop()`, and reads
 * `getStatus()` on whatever channel(s) it's given.
 *
 * Design notes for that future extension:
 * - `fire()` must never throw past its own boundary — a future multi-channel
 *   fan-out (e.g. local alarm + push) should be able to call `fire()` on every
 *   configured channel and have one channel's failure (e.g. denied
 *   notification permission) not block another's (e.g. the audio alarm still
 *   playing). `LocalAlarmChannel` follows this today even as the only channel.
 * - `getStatus()` must reflect real, current capability — never silently
 *   report a channel as available when it isn't. The UI reads this directly
 *   to disclose what will actually happen on expiry (see CLAUDE.md's
 *   "never let a UI imply a guarantee the system can't back").
 * - `prime()` exists because some browser APIs (Web Audio autoplay policy,
 *   Notification permission) require or strongly prefer being invoked from a
 *   user gesture. Callers should call it from the same tap that starts the
 *   timer, not lazily on first `fire()` (which runs on an interval/timeout
 *   callback, not a user gesture, and may be unable to unlock audio then).
 */

import { logger } from "./logger";

export type AlertPermissionState = "granted" | "denied" | "default" | "unsupported";

/** Best-known, current capability of a channel — surfaced directly in the UI. */
export interface AlertChannelStatus {
  channelId: string;
  /** Human-readable description of what this channel does, for UI disclosure. */
  label: string;
  notification: AlertPermissionState;
  audio: "unlocked" | "locked" | "unsupported";
  vibration: "supported" | "unsupported";
}

export interface AlertFireContext {
  title: string;
  body: string;
  /** Epoch ms the alert was triggered — useful once a channel needs to show "last known good" timing (see THREAT_MODEL.md §0.1's opportunistic-send idea, not built in v1). */
  timestamp: number;
}

export interface AlertChannel {
  readonly id: string;
  readonly label: string;

  /**
   * Prepare the channel: request permissions and/or unlock any audio/media
   * context. Call from a user gesture (e.g. the "Start Timer" tap). Safe to
   * call more than once; must never throw — swallow and log failures so a
   * denied permission doesn't block starting the timer itself.
   */
  prime(): Promise<void>;

  /**
   * Fire the alert on timer expiry. Must be resilient: a failure in one
   * underlying mechanism (e.g. Notification blocked) must not prevent the
   * others (e.g. audio, vibration) from still running.
   */
  fire(context: AlertFireContext): Promise<void>;

  /** Stop any in-progress alert started by `fire()` (sound/vibration loop). Does not change permission state. */
  stop(): void;

  /** Current, real capability — never a cached "should work" guess. */
  getStatus(): AlertChannelStatus;
}

const ALARM_STORAGE_TAG = "shore-dive-safe-return";

/**
 * v1's only concrete channel: alerts the person holding this device, on this
 * device, via whatever of {Notification, Web Audio, Vibration} the browser
 * currently supports and has permitted. Never reaches the network.
 */
export class LocalAlarmChannel implements AlertChannel {
  readonly id = "local-alarm";
  readonly label = "This device (sound, vibration, notification)";

  private audioCtx: AudioContext | null = null;
  private audioUnlocked = false;
  private stopRequested = true;
  private loopTimeoutId: number | null = null;
  private activeOscillators: OscillatorNode[] = [];

  async prime(): Promise<void> {
    await this.primeAudio();
    await this.primeNotifications();
  }

  private async primeAudio(): Promise<void> {
    try {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        logger.warn("safe-return.audio-unsupported");
        return;
      }
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextCtor();
      }
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }
      // A near-silent blip fully unlocks the context on some browsers that
      // require an actual sound to have played during the gesture, not just
      // resume() being called.
      this.beep(440, 0.01, 0.0001);
      this.audioUnlocked = this.audioCtx.state === "running";
    } catch (err) {
      this.audioUnlocked = false;
      logger.warn("safe-return.audio-prime-failed", { error: describeError(err) });
    }
  }

  private async primeNotifications(): Promise<void> {
    try {
      if (typeof Notification === "undefined") {
        logger.warn("safe-return.notification-unsupported");
        return;
      }
      if (Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch (err) {
      logger.warn("safe-return.notification-prime-failed", { error: describeError(err) });
    }
  }

  async fire(context: AlertFireContext): Promise<void> {
    this.stopRequested = false;

    // Each mechanism is independently try/caught so one failing (e.g. denied
    // notification permission) never prevents the others from still alerting.
    await this.fireNotification(context);
    this.fireVibration();
    await this.fireAudioLoop();
  }

  private async fireNotification(context: AlertFireContext): Promise<void> {
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") {
        logger.warn("safe-return.notification-not-permitted", { permission: Notification.permission });
        return;
      }
      // Fire-and-forget alert notification — we don't need a handle to it.
      new Notification(context.title, {
        body: context.body,
        requireInteraction: true,
        tag: ALARM_STORAGE_TAG,
      });
    } catch (err) {
      logger.error("safe-return.notification-fire-failed", { error: describeError(err) });
    }
  }

  private fireVibration(): void {
    try {
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
        logger.warn("safe-return.vibration-unsupported");
        return;
      }
      // Repeating buzz-pause pattern; the browser stops it automatically once
      // the tab is hidden long enough on most platforms, and it isn't
      // available on iOS Safari at all — expected, not an error.
      navigator.vibrate([500, 250, 500, 250, 500, 250, 500]);
    } catch (err) {
      logger.warn("safe-return.vibration-failed", { error: describeError(err) });
    }
  }

  private async fireAudioLoop(): Promise<void> {
    try {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) {
        logger.warn("safe-return.audio-unsupported");
        return;
      }
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextCtor();
      }
      if (this.audioCtx.state === "suspended") {
        // `fire()` runs off a timer callback, not a user gesture, so this can
        // legitimately fail to resume on browsers with a strict autoplay
        // policy if `prime()` was never called (or its unlock didn't stick).
        // getStatus().audio reflects that so the UI can disclose it.
        await this.audioCtx.resume().catch(() => undefined);
      }
      this.audioUnlocked = this.audioCtx.state === "running";
      this.playAlarmPattern();
    } catch (err) {
      logger.error("safe-return.audio-fire-failed", { error: describeError(err) });
    }
  }

  /** Two-tone siren pattern, looping until `stop()` is called. */
  private playAlarmPattern(): void {
    if (this.stopRequested || !this.audioCtx) return;
    this.beep(880, 0.35, 0.35);
    this.loopTimeoutId = window.setTimeout(() => {
      if (this.stopRequested) return;
      this.beep(660, 0.35, 0.35);
      this.loopTimeoutId = window.setTimeout(() => this.playAlarmPattern(), 700);
    }, 500);
  }

  private beep(frequencyHz: number, durationSec: number, gainValue: number): void {
    if (!this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = frequencyHz;
      gain.gain.value = gainValue;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + durationSec);
      this.activeOscillators.push(osc);
      osc.addEventListener("ended", () => {
        this.activeOscillators = this.activeOscillators.filter((node) => node !== osc);
      });
    } catch (err) {
      logger.warn("safe-return.beep-failed", { error: describeError(err) });
    }
  }

  stop(): void {
    this.stopRequested = true;
    if (this.loopTimeoutId !== null) {
      window.clearTimeout(this.loopTimeoutId);
      this.loopTimeoutId = null;
    }
    for (const osc of this.activeOscillators) {
      try {
        osc.stop();
      } catch {
        // Already stopped/ended — nothing to do.
      }
    }
    this.activeOscillators = [];
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(0);
      }
    } catch (err) {
      logger.warn("safe-return.vibration-stop-failed", { error: describeError(err) });
    }
  }

  getStatus(): AlertChannelStatus {
    return {
      channelId: this.id,
      label: this.label,
      notification: getNotificationPermission(),
      audio: getAudioStatus(this.audioCtx, this.audioUnlocked),
      vibration:
        typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? "supported" : "unsupported",
    };
  }
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function getAudioStatus(ctx: AudioContext | null, unlocked: boolean): AlertChannelStatus["audio"] {
  if (!getAudioContextConstructor()) return "unsupported";
  if (ctx && unlocked && ctx.state === "running") return "unlocked";
  return "locked";
}

function getNotificationPermission(): AlertPermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
