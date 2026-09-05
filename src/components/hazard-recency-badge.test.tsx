// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HazardRecencyBadge } from "./hazard-recency-badge";

/**
 * Coverage for the hazard-report recency badge (plan.md's Task 13 v5
 * addition). The property that matters most: recency is legible as real
 * text on every tier, not just a color swap (accessibility — plan.md's
 * engineering-standards addenda on non-color-only encoding), and an invalid
 * timestamp fails toward the least-trusted rendering rather than silently
 * looking fresh.
 */

afterEach(cleanup);

const NOW = new Date("2026-08-21T12:00:00.000Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return hoursAgo(days * 24);
}

describe("HazardRecencyBadge", () => {
  it("renders a fresh report with a relative time and no qualifier text", () => {
    render(<HazardRecencyBadge reportedAt={hoursAgo(2)} now={NOW} />);
    expect(screen.getByText(/2 hours ago/)).toBeTruthy();
    expect(screen.queryByText(/aging|dated/)).toBeNull();
  });

  it("renders an aging report with an explicit 'aging' qualifier, not just a color change", () => {
    render(<HazardRecencyBadge reportedAt={daysAgo(14)} now={NOW} />);
    expect(screen.getByText(/aging/)).toBeTruthy();
  });

  it("renders a stale report with explicit text that it may not reflect current conditions", () => {
    render(<HazardRecencyBadge reportedAt={daysAgo(90)} now={NOW} />);
    expect(screen.getByText(/may not reflect current conditions/)).toBeTruthy();
  });

  it("fails toward the least-trusted rendering on an invalid timestamp, never toward looking fresh", () => {
    render(<HazardRecencyBadge reportedAt="not-a-real-date" now={NOW} />);
    expect(screen.getByText(/missing or invalid/)).toBeTruthy();
    expect(screen.queryByText(/just now|ago/)).toBeNull();
  });

  it("carries the absolute timestamp in the title attribute, same discoverable-on-hover pattern as FreshnessBadge", () => {
    render(<HazardRecencyBadge reportedAt={daysAgo(1)} now={NOW} />);
    const badge = screen.getByTitle(/^Reported /);
    expect(badge).toBeTruthy();
  });
});
