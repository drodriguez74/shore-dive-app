// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertChannel, AlertChannelStatus } from "@/lib/safe-return/alert-channel";
import type { UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import { ExpiredView } from "./expired-view";
import { RunningTimerView } from "./running-timer-view";
import { StartScreen } from "./start-screen";

afterEach(cleanup);

function fakeChannel(status: Partial<AlertChannelStatus> = {}): AlertChannel {
  return {
    id: "fake",
    label: "Fake channel",
    prime: vi.fn(async () => {}),
    fire: vi.fn(async () => {}),
    stop: vi.fn(),
    getStatus: () => ({
      channelId: "fake",
      label: "Fake channel",
      notification: "granted",
      audio: "unlocked",
      vibration: "supported",
      ...status,
    }),
  };
}

function fakeTimer(overrides: Partial<UseSafeReturnTimerResult> = {}): UseSafeReturnTimerResult {
  return {
    status: "idle",
    durationMs: 0,
    startedAt: null,
    label: "",
    remainingMs: 0,
    isHydrated: true,
    recoveredFromCorruptState: false,
    dismissRecoveryNotice: vi.fn(),
    start: vi.fn(),
    checkIn: vi.fn(),
    silenceAlarm: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

/** Phrases that would promise something a local-only timer cannot deliver. */
const FALSE_GUARANTEES = /help is (coming|on the way)|will be notified|we('ll| will) (alert|contact|notify)|has been (alerted|notified)/i;

describe("StartScreen", () => {
  it("won't start until the diver acknowledges the limits, then primes alerts and starts", async () => {
    const timer = fakeTimer();
    const channel = fakeChannel();
    render(<StartScreen timer={timer} alertChannel={channel} />);

    const startButton = screen.getByRole("button", { name: "Start Timer" }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    fireEvent.click(startButton);
    expect(timer.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox", { name: /nobody else is notified/i }));
    expect(startButton.disabled).toBe(false);
    fireEvent.click(startButton);

    await waitFor(() => expect(timer.start).toHaveBeenCalledWith(60 * 60 * 1000, ""));
    expect(channel.prime).toHaveBeenCalledTimes(1);
  });

  it("still starts the countdown when priming the alarm fails", async () => {
    const timer = fakeTimer();
    const channel = fakeChannel();
    channel.prime = vi.fn(async () => {
      throw new Error("audio blocked");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<StartScreen timer={timer} alertChannel={channel} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /nobody else is notified/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start Timer" }));

    await waitFor(() => expect(timer.start).toHaveBeenCalledTimes(1));
    vi.restoreAllMocks();
  });

  it("states the limits plainly and promises nothing it can't do", () => {
    const { container } = render(<StartScreen timer={fakeTimer()} alertChannel={fakeChannel()} />);

    expect(screen.getByText(/does not\s+notify anyone else/i)).toBeTruthy();
    expect(screen.getAllByText(/iPhone/).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(FALSE_GUARANTEES);
  });

  it("reports which alert mechanisms are actually unavailable", () => {
    render(
      <StartScreen
        timer={fakeTimer()}
        alertChannel={fakeChannel({ notification: "denied", audio: "locked", vibration: "unsupported" })}
      />,
    );

    expect(screen.getByText(/notifications: blocked/)).toBeTruthy();
    expect(screen.getByText(/alarm sound: not yet unlocked/)).toBeTruthy();
    expect(screen.getByText(/vibration: not available \(expected on iPhone\)/)).toBeTruthy();
  });
});

describe("RunningTimerView", () => {
  it("shows the time remaining and keeps the limitation reminder on screen", () => {
    const { container } = render(
      <RunningTimerView
        timer={fakeTimer({ status: "running", remainingMs: 61 * 60 * 1000, label: "Blue Heron" })}
        alertChannel={fakeChannel()}
      />,
    );

    expect(screen.getByText("Blue Heron")).toBeTruthy();
    expect(screen.getByText(/1:01:00|61:00/)).toBeTruthy();
    expect(screen.getByText(/nobody else is notified/)).toBeTruthy();
    expect(container.textContent).not.toMatch(FALSE_GUARANTEES);
  });

  it("does not check in on a single click", () => {
    const timer = fakeTimer({ status: "running", remainingMs: 1000 });
    render(<RunningTimerView timer={timer} alertChannel={fakeChannel()} />);

    fireEvent.click(screen.getByRole("button", { name: /Hold to check in/ }));

    expect(timer.checkIn).not.toHaveBeenCalled();
  });
});

describe("ExpiredView", () => {
  it("says this device is alerting, shows what actually fired, and claims nothing more", () => {
    const { container } = render(
      <ExpiredView
        timer={fakeTimer({ status: "expired", label: "Blue Heron" })}
        alertChannel={fakeChannel({ notification: "denied" })}
      />,
    );

    expect(screen.getByText(/Timer expired — Blue Heron/)).toBeTruthy();
    expect(screen.getByText(/This device is alerting now/)).toBeTruthy();
    expect(screen.getByText(/notifications: blocked/)).toBeTruthy();
    expect(container.textContent).not.toMatch(FALSE_GUARANTEES);
  });

  it("silencing the alarm is not a check-in", () => {
    const timer = fakeTimer({ status: "expired" });
    render(<ExpiredView timer={timer} alertChannel={fakeChannel()} />);

    fireEvent.click(screen.getByRole("button", { name: "Silence alarm" }));

    expect(timer.silenceAlarm).toHaveBeenCalledTimes(1);
    expect(timer.checkIn).not.toHaveBeenCalled();
  });

  it("requires a deliberate confirm to check in, even after expiry", () => {
    const timer = fakeTimer({ status: "expired" });
    render(<ExpiredView timer={timer} alertChannel={fakeChannel()} />);
    const checkIn = screen.getByRole("button", { name: /Hold to check in/ });

    fireEvent.click(checkIn);
    expect(timer.checkIn).not.toHaveBeenCalled();

    fireEvent.keyDown(checkIn, { key: "Enter" });
    fireEvent.keyDown(checkIn, { key: "Enter" });
    expect(timer.checkIn).toHaveBeenCalledTimes(1);
  });
});
