// @vitest-environment jsdom

/**
 * Tests for `LocalAlarmChannel`, the v1 Safe-Return alert channel.
 *
 * Scope note: these tests target the *degradation and resilience* contract the
 * file's own header commits to — "`fire()` must never throw past its own
 * boundary", "one mechanism failing must not prevent the others", and
 * "`getStatus()` must reflect real, current capability, never a should-work
 * guess". Those are the honest-disclosure guarantees the product makes to a
 * diver (CLAUDE.md: "never let a UI imply a guarantee the system can't back"),
 * so they're worth real coverage even though every branch runs against stubs.
 *
 * Deliberately NOT covered: the audio-synthesis internals (exact frequencies,
 * gain values, the 500/700ms cadence of the two-tone pattern). Those are
 * tunable presentation details with no correctness contract, and asserting
 * them against a fake AudioContext would test the fake, not the alarm. What is
 * covered is the part that matters: the loop actually starts, keeps going, and
 * genuinely stops when `stop()` is called.
 *
 * jsdom implements none of Notification / AudioContext / navigator.vibrate, so
 * the un-patched baseline is a browser with zero alarm capability — which is
 * itself one of the cases worth testing (see "no browser support at all").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAlarmChannel, type AlertFireContext } from "./alert-channel";

// --- Global patching ------------------------------------------------------

const restores: Array<() => void> = [];

function patchProperty(target: object, key: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  restores.push(() => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  });
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

/**
 * The channel reads some APIs off the bare global (`Notification`,
 * `navigator`) and others off `window` (`AudioContext`), which are not the
 * same object under Vitest's jsdom environment — so patch both.
 */
function patchGlobal(key: string, value: unknown): void {
  const globalObject = globalThis as unknown as object;
  const windowObject = window as unknown as object;
  const targets = globalObject === windowObject ? [globalObject] : [globalObject, windowObject];
  for (const target of targets) patchProperty(target, key, value);
}

// --- Fakes ----------------------------------------------------------------

class FakeOscillator {
  type = "";
  frequency = { value: 0 };
  stopArgs: Array<number | undefined> = [];
  throwOnBareStop = false;
  private endedListeners: Array<() => void> = [];

  connect(target: unknown): unknown {
    return target;
  }
  start(): void {}
  stop(when?: number): void {
    this.stopArgs.push(when);
    if (when === undefined && this.throwOnBareStop) throw new Error("already stopped");
  }
  addEventListener(name: string, callback: () => void): void {
    if (name === "ended") this.endedListeners.push(callback);
  }
  emitEnded(): void {
    for (const callback of this.endedListeners) callback();
  }
}

class FakeGainNode {
  gain = { value: 0 };
  connect(target: unknown): unknown {
    return target;
  }
}

const audioConfig = {
  constructorThrows: false,
  resumeRejects: false,
  resumeSucceeds: true,
  initialState: "suspended" as "suspended" | "running",
};

let audioInstances: FakeAudioContext[] = [];

class FakeAudioContext {
  state: "suspended" | "running" = audioConfig.initialState;
  currentTime = 0;
  destination = { id: "destination" };
  oscillators: FakeOscillator[] = [];
  resumeCalls = 0;

  constructor() {
    if (audioConfig.constructorThrows) throw new Error("AudioContext unavailable");
    audioInstances.push(this);
  }
  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (audioConfig.resumeRejects) throw new Error("autoplay policy blocked resume");
    if (audioConfig.resumeSucceeds) this.state = "running";
  }
  createOscillator(): FakeOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
}

const notificationConfig = { constructorThrows: false };
let notificationInstances: Array<{ title: string; options: NotificationOptions | undefined }> = [];

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => "granted");

  constructor(title: string, options?: NotificationOptions) {
    if (notificationConfig.constructorThrows) throw new Error("notification construction failed");
    notificationInstances.push({ title, options });
  }
}

// --- Helpers --------------------------------------------------------------

function enableAudio(): void {
  patchGlobal("AudioContext", FakeAudioContext);
}

function enableNotifications(permission: NotificationPermission): void {
  FakeNotification.permission = permission;
  patchGlobal("Notification", FakeNotification);
}

function enableVibration(): ReturnType<typeof vi.fn> {
  const vibrate = vi.fn(() => true);
  patchProperty(navigator, "vibrate", vibrate);
  return vibrate;
}

function fireContext(overrides: Partial<AlertFireContext> = {}): AlertFireContext {
  return {
    title: "Safe-Return timer expired",
    body: "You didn't check in. If you're safe, open the app and check in.",
    timestamp: 1_800_000_000_000,
    ...overrides,
  };
}

function activeContext(): FakeAudioContext {
  const instance = audioInstances[0];
  expect(instance).toBeDefined();
  return instance;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  audioInstances = [];
  notificationInstances = [];
  audioConfig.constructorThrows = false;
  audioConfig.resumeRejects = false;
  audioConfig.resumeSucceeds = true;
  audioConfig.initialState = "suspended";
  notificationConfig.constructorThrows = false;
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
});

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("LocalAlarmChannel — identity", () => {
  it("exposes a stable id and a user-facing label describing what it actually does", () => {
    const channel = new LocalAlarmChannel();
    expect(channel.id).toBe("local-alarm");
    expect(channel.label).toBe("This device (sound, vibration, notification)");
  });
});

describe("LocalAlarmChannel — getStatus reports real capability", () => {
  it("reports everything unsupported on a browser with none of the APIs", () => {
    const status = new LocalAlarmChannel().getStatus();
    expect(status).toEqual({
      channelId: "local-alarm",
      label: "This device (sound, vibration, notification)",
      notification: "unsupported",
      audio: "unsupported",
      vibration: "unsupported",
    });
  });

  it("reports the real notification permission, including denied", () => {
    enableNotifications("denied");
    expect(new LocalAlarmChannel().getStatus().notification).toBe("denied");

    FakeNotification.permission = "granted";
    expect(new LocalAlarmChannel().getStatus().notification).toBe("granted");

    FakeNotification.permission = "default";
    expect(new LocalAlarmChannel().getStatus().notification).toBe("default");
  });

  it("reports audio as locked — not unlocked — when the API exists but was never primed", () => {
    enableAudio();
    expect(new LocalAlarmChannel().getStatus().audio).toBe("locked");
  });

  it("reports audio as unlocked only after a successful prime", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.prime();
    expect(channel.getStatus().audio).toBe("unlocked");
  });

  it("keeps reporting audio as locked when the context refuses to resume", async () => {
    audioConfig.resumeSucceeds = false;
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.prime();
    expect(channel.getStatus().audio).toBe("locked");
  });

  it("detects the prefixed webkitAudioContext as support rather than reporting unsupported", () => {
    patchGlobal("webkitAudioContext", FakeAudioContext);
    expect(new LocalAlarmChannel().getStatus().audio).toBe("locked");
  });

  it("reports vibration support from the live navigator", () => {
    expect(new LocalAlarmChannel().getStatus().vibration).toBe("unsupported");
    enableVibration();
    expect(new LocalAlarmChannel().getStatus().vibration).toBe("supported");
  });
});

describe("LocalAlarmChannel — prime degrades instead of throwing", () => {
  it("resolves and logs when no browser support exists at all", async () => {
    const channel = new LocalAlarmChannel();
    await expect(channel.prime()).resolves.toBeUndefined();
    const events = warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(events.some((event: string) => event.includes("safe-return.audio-unsupported"))).toBe(true);
    expect(events.some((event: string) => event.includes("safe-return.notification-unsupported"))).toBe(true);
  });

  it("requests notification permission when it has not been decided yet", async () => {
    enableNotifications("default");
    await new LocalAlarmChannel().prime();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not re-prompt when permission is already granted or already denied", async () => {
    enableNotifications("granted");
    await new LocalAlarmChannel().prime();
    FakeNotification.permission = "denied";
    await new LocalAlarmChannel().prime();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("swallows a rejected permission request", async () => {
    enableNotifications("default");
    FakeNotification.requestPermission.mockRejectedValueOnce(new Error("permission API exploded"));
    await expect(new LocalAlarmChannel().prime()).resolves.toBeUndefined();
    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain("safe-return.notification-prime-failed");
  });

  it("swallows an AudioContext constructor failure and leaves audio locked", async () => {
    audioConfig.constructorThrows = true;
    enableAudio();
    const channel = new LocalAlarmChannel();
    await expect(channel.prime()).resolves.toBeUndefined();
    expect(channel.getStatus().audio).toBe("locked");
    expect(String(warnSpy.mock.calls[0][0])).toContain("safe-return.audio-prime-failed");
  });

  it("swallows a rejected resume and leaves audio locked", async () => {
    audioConfig.resumeRejects = true;
    enableAudio();
    const channel = new LocalAlarmChannel();
    await expect(channel.prime()).resolves.toBeUndefined();
    expect(channel.getStatus().audio).toBe("locked");
  });

  it("reuses a single AudioContext across repeated primes", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.prime();
    await channel.prime();
    expect(audioInstances).toHaveLength(1);
  });
});

describe("LocalAlarmChannel — fire degrades instead of throwing", () => {
  it("resolves without throwing when the browser supports none of the mechanisms", async () => {
    await expect(new LocalAlarmChannel().fire(fireContext())).resolves.toBeUndefined();
    expect(notificationInstances).toHaveLength(0);
  });

  it("does not post a notification when permission is denied, and says so in the log", async () => {
    enableNotifications("denied");
    await new LocalAlarmChannel().fire(fireContext());

    expect(notificationInstances).toHaveLength(0);
    const warning = warnSpy.mock.calls.map((call: unknown[]) => String(call[0])).find((event: string) => event.includes("not-permitted"));
    expect(warning).toContain("safe-return.notification-not-permitted");
    expect(warning).toContain("denied");
  });

  it("posts a persistent, tagged notification when permission is granted", async () => {
    enableNotifications("granted");
    await new LocalAlarmChannel().fire(fireContext({ title: "Safe-Return timer expired", body: "Check in." }));

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].title).toBe("Safe-Return timer expired");
    expect(notificationInstances[0].options).toMatchObject({
      body: "Check in.",
      // requireInteraction keeps the alert on screen until acknowledged — the
      // whole point of an alarm the diver may not be looking at.
      requireInteraction: true,
      tag: "shore-dive-safe-return",
    });
  });

  it("still vibrates and still sounds the alarm when the notification throws", async () => {
    enableNotifications("granted");
    notificationConfig.constructorThrows = true;
    const vibrate = enableVibration();
    enableAudio();

    await expect(new LocalAlarmChannel().fire(fireContext())).resolves.toBeUndefined();

    expect(String(errorSpy.mock.calls[0][0])).toContain("safe-return.notification-fire-failed");
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(activeContext().oscillators.length).toBeGreaterThan(0);
  });

  it("still sounds the alarm when vibration throws", async () => {
    const vibrate = vi.fn(() => {
      throw new Error("vibration blocked");
    });
    patchProperty(navigator, "vibrate", vibrate);
    enableAudio();

    await expect(new LocalAlarmChannel().fire(fireContext())).resolves.toBeUndefined();
    expect(activeContext().oscillators.length).toBeGreaterThan(0);
  });

  it("vibrates with a repeating buzz-pause pattern", async () => {
    const vibrate = enableVibration();
    await new LocalAlarmChannel().fire(fireContext());

    expect(vibrate).toHaveBeenCalledTimes(1);
    const pattern = vibrate.mock.calls[0][0] as number[];
    expect(Array.isArray(pattern)).toBe(true);
    expect(pattern.length).toBeGreaterThan(1);
  });

  it("logs vibration as unsupported rather than failing when navigator.vibrate is absent", async () => {
    await new LocalAlarmChannel().fire(fireContext());
    const events = warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(events.some((event: string) => event.includes("safe-return.vibration-unsupported"))).toBe(true);
  });

  it("starts a looping alarm that keeps producing tones over time", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    const context = activeContext();
    const initial = context.oscillators.length;
    expect(initial).toBeGreaterThan(0);

    vi.advanceTimersByTime(5_000);
    expect(context.oscillators.length).toBeGreaterThan(initial);

    channel.stop();
  });

  it("resumes a suspended context on fire so a primed-then-backgrounded tab can still alarm", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    expect(activeContext().resumeCalls).toBe(1);
    expect(channel.getStatus().audio).toBe("unlocked");
    channel.stop();
  });

  it("does not throw when the context refuses to resume — it just stays locked", async () => {
    audioConfig.resumeRejects = true;
    enableAudio();
    const channel = new LocalAlarmChannel();

    await expect(channel.fire(fireContext())).resolves.toBeUndefined();
    expect(channel.getStatus().audio).toBe("locked");
  });
});

describe("LocalAlarmChannel — stop is always safe", () => {
  it("does not throw when nothing is playing", () => {
    expect(() => new LocalAlarmChannel().stop()).not.toThrow();
  });

  it("does not throw when called twice in a row", async () => {
    enableAudio();
    enableVibration();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    expect(() => {
      channel.stop();
      channel.stop();
    }).not.toThrow();
  });

  it("genuinely halts the alarm loop — no further tones are produced", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    vi.advanceTimersByTime(1_500);
    const context = activeContext();
    channel.stop();
    const atStop = context.oscillators.length;

    vi.advanceTimersByTime(60_000);
    expect(context.oscillators.length).toBe(atStop);
  });

  it("stops every oscillator it started and cancels vibration", async () => {
    enableAudio();
    const vibrate = enableVibration();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    const context = activeContext();
    channel.stop();

    for (const oscillator of context.oscillators) {
      expect(oscillator.stopArgs).toContain(undefined);
    }
    expect(vibrate).toHaveBeenLastCalledWith(0);
  });

  it("survives an oscillator that throws when stopped", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    const context = activeContext();
    for (const oscillator of context.oscillators) oscillator.throwOnBareStop = true;

    expect(() => channel.stop()).not.toThrow();
  });

  it("swallows a throwing navigator.vibrate", async () => {
    patchProperty(navigator, "vibrate", () => {
      throw new Error("vibration blocked");
    });
    const channel = new LocalAlarmChannel();
    expect(() => channel.stop()).not.toThrow();
    expect(String(warnSpy.mock.calls.at(-1)?.[0])).toContain("safe-return.vibration-stop-failed");
  });

  it("lets a later fire() start a fresh alarm after a stop", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());
    channel.stop();

    const context = activeContext();
    const afterStop = context.oscillators.length;

    await channel.fire(fireContext());
    vi.advanceTimersByTime(1_500);
    expect(context.oscillators.length).toBeGreaterThan(afterStop);
    channel.stop();
  });

  it("drops finished oscillators from its active list when they report ended", async () => {
    enableAudio();
    const channel = new LocalAlarmChannel();
    await channel.fire(fireContext());

    const context = activeContext();
    for (const oscillator of context.oscillators) oscillator.emitEnded();
    channel.stop();

    // Every oscillator had already ended, so stop() should not have re-stopped
    // any of them (only the scheduled stop from beep() is recorded).
    for (const oscillator of context.oscillators) {
      expect(oscillator.stopArgs).not.toContain(undefined);
    }
  });
});
