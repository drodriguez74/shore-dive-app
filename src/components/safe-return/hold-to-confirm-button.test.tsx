// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldToConfirmButton } from "./hold-to-confirm-button";

/**
 * Check-in must be a deliberate act, never a passive tap (CLAUDE.md, Task 15).
 */
describe("HoldToConfirmButton", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup(props: Partial<Parameters<typeof HoldToConfirmButton>[0]> = {}) {
    const onConfirm = vi.fn();
    render(<HoldToConfirmButton label="Hold to check in" onConfirm={onConfirm} holdMs={1500} {...props} />);
    return { onConfirm, button: screen.getByRole("button") };
  }

  it("does not confirm on a quick tap or click", () => {
    const { onConfirm, button } = setup();

    fireEvent.pointerDown(button);
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    act(() => void vi.advanceTimersByTime(5000));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms once the press is held for the full duration", () => {
    const { onConfirm, button } = setup();

    fireEvent.pointerDown(button);
    act(() => void vi.advanceTimersByTime(1400));
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(200));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels the hold when the pointer leaves the button", () => {
    const { onConfirm, button } = setup();

    fireEvent.pointerDown(button);
    act(() => void vi.advanceTimersByTime(1000));
    fireEvent.pointerLeave(button);
    act(() => void vi.advanceTimersByTime(2000));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("needs two keyboard activations: the first only arms it", () => {
    const { onConfirm, button } = setup({ armedLabel: "Press again to confirm" });

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Press again to confirm")).toBeTruthy();

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disarms if the second keyboard press doesn't come within the window", () => {
    const { onConfirm, button } = setup();

    fireEvent.keyDown(button, { key: "Enter" });
    act(() => void vi.advanceTimersByTime(3100));
    expect(screen.getByText("Hold to check in")).toBeTruthy();

    fireEvent.keyDown(button, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores everything while disabled", () => {
    const { onConfirm, button } = setup({ disabled: true });

    fireEvent.pointerDown(button);
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.keyDown(button, { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
