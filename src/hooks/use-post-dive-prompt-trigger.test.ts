import { describe, expect, it } from "vitest";
import { evaluatePostDiveTrigger, type DivePlanCheckInState, type EvaluatePostDiveTriggerInput } from "./use-post-dive-prompt-trigger";

const NOW = 1_800_000_000_000;

function activePlan(overrides: Partial<DivePlanCheckInState> = {}): DivePlanCheckInState {
  return { isActive: true, siteId: "site-1", checkedInAt: null, ...overrides };
}

function endedPlan(checkedInAt: number, overrides: Partial<DivePlanCheckInState> = {}): DivePlanCheckInState {
  return { isActive: false, siteId: "site-1", checkedInAt, ...overrides };
}

function baseInput(overrides: Partial<EvaluatePostDiveTriggerInput> = {}): EvaluatePostDiveTriggerInput {
  return {
    previousCheckInState: undefined,
    checkInState: undefined,
    previousSafeReturnStatus: undefined,
    safeReturnStatus: undefined,
    now: NOW,
    ...overrides,
  };
}

describe("evaluatePostDiveTrigger", () => {
  it("fires on a dive-plan check-in just ending (active -> inactive, recently checked in)", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: activePlan(),
        checkInState: endedPlan(NOW - 1000),
      }),
    );
    expect(decision).toEqual({ fire: true, source: "dive-plan-check-in" });
  });

  it("fires on the Safe-Return timer transitioning running -> checked-in", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousSafeReturnStatus: "running",
        safeReturnStatus: "checked-in",
      }),
    );
    expect(decision).toEqual({ fire: true, source: "safe-return-checked-in" });
  });

  it("does NOT fire on the Safe-Return timer expiring (deliberate exclusion)", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousSafeReturnStatus: "running",
        safeReturnStatus: "expired",
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not fire when nothing changed", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousSafeReturnStatus: "idle",
        safeReturnStatus: "idle",
        previousCheckInState: undefined,
        checkInState: undefined,
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not fire when the dive-plan check-in ended outside the recency window", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: activePlan(),
        checkInState: endedPlan(NOW - 20 * 60 * 1000), // 20 min ago, default window is 15 min
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("respects a custom recentWindowMs", () => {
    const input = baseInput({
      previousCheckInState: activePlan(),
      checkInState: endedPlan(NOW - 20 * 60 * 1000),
      recentWindowMs: 30 * 60 * 1000,
    });
    expect(evaluatePostDiveTrigger(input)).toEqual({ fire: true, source: "dive-plan-check-in" });
  });

  it("does not fire when checkedInAt is null even though isActive flipped to false", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: activePlan(),
        checkInState: { isActive: false, siteId: "site-1", checkedInAt: null },
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not fire when checkedInAt is in the future relative to now (guards a bad clock/rehydration)", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: activePlan(),
        checkInState: endedPlan(NOW + 5000),
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not fire when the plan was already inactive (no active -> inactive edge)", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: endedPlan(NOW - 1000),
        checkInState: endedPlan(NOW - 500),
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not fire on checked-in -> running (wrong direction)", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousSafeReturnStatus: "checked-in",
        safeReturnStatus: "running",
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("does not treat a manual reset from expired as a checked-in transition", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousSafeReturnStatus: "expired",
        safeReturnStatus: "idle",
      }),
    );
    expect(decision).toEqual({ fire: false, source: null });
  });

  it("prefers the dive-plan signal when both signals would fire simultaneously", () => {
    const decision = evaluatePostDiveTrigger(
      baseInput({
        previousCheckInState: activePlan(),
        checkInState: endedPlan(NOW - 1000),
        previousSafeReturnStatus: "running",
        safeReturnStatus: "checked-in",
      }),
    );
    expect(decision).toEqual({ fire: true, source: "dive-plan-check-in" });
  });
});
