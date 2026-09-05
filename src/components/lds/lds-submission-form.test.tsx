// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LdsSubmissionForm } from "./lds-submission-form";
import type { LdsStatusRow } from "./lds-status";

/**
 * Behavioral cover for the LDS report form's real write path (Task 16,
 * 2026-08-20 — replacing the `localStorage` stand-in that made every report
 * silently reach nobody).
 *
 * These assertions are about honesty obligations, not presentation, which is
 * why they're worth a jsdom test rather than a reviewer's eyeball:
 *  - a signed-out diver must never be handed a form that cannot possibly
 *    file (the insert policy is granted `to authenticated`),
 *  - a failed write must never be reported as a success, and must never
 *    merge a phantom row into the caller's marker state,
 *  - an offline/network failure must say the report was NOT saved, because
 *    this app assumes the diver is at the water's edge with no signal.
 */

const marker: LdsStatusRow = {
  id: "row-1",
  site_id: null,
  name: "Blue Water Divers",
  latitude: 26.1224,
  longitude: -80.1373,
  status: "open",
  provenance: "COMMUNITY",
  last_verified_at: "2026-08-20T12:00:00.000Z",
  created_by: "user-1",
  created_at: "2026-08-20T12:00:00.000Z",
};

function renderForm(overrides: Partial<Parameters<typeof LdsSubmissionForm>[0]> = {}) {
  const onSubmitted = vi.fn();
  const onClose = vi.fn();
  render(
    <LdsSubmissionForm
      siteId={null}
      shopName="Blue Water Divers"
      latitude={26.1224}
      longitude={-80.1373}
      isSignedIn
      onSubmitted={onSubmitted}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmitted, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LdsSubmissionForm — signed out", () => {
  it("shows a real sign-in prompt instead of a form that could never be filed", () => {
    renderForm({ isSignedIn: false });

    expect(screen.getByText(/Sign in to report a status/)).toBeTruthy();
    const signIn = screen.getByRole("link", { name: /sign in/i }) as HTMLAnchorElement;
    expect(signIn.getAttribute("href")).toBe("/login");
    // The form itself must not exist — not merely be disabled.
    expect(screen.queryByRole("button", { name: /submit report/i })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("LdsSubmissionForm — signed in", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ marker }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
  });

  it("offers no VERIFIED option — the provenance invariant, enforced in the UI too", () => {
    renderForm();
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["open", "limited", "closed", "unknown"]);
    expect(options).not.toContain("VERIFIED");
  });

  it("POSTs to the real route and never sends provenance or created_by", async () => {
    renderForm();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "closed" } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/lds/submit");
    expect(init?.method).toBe("POST");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toEqual({
      site_id: null,
      name: "Blue Water Divers",
      latitude: 26.1224,
      longitude: -80.1373,
      status: "closed",
    });
    expect(sent).not.toHaveProperty("provenance");
    expect(sent).not.toHaveProperty("created_by");
  });

  it("hands the server's row to the caller so the list/pin can update without a reload", async () => {
    const { onSubmitted } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(marker));
  });

  it("confirms what actually happened, without claiming instant or verified propagation", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/Report saved/)).toBeTruthy());
    expect(screen.getByText(/next time they load/)).toBeTruthy();
    expect(screen.getByText(/doesn't make the listing Verified/)).toBeTruthy();
  });

  it("surfaces the server's own error message and merges nothing on failure", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Rate limit exceeded: you can submit at most 5 row(s) to lds_status per 10 minute(s).",
        }),
        { status: 429 },
      ),
    );
    const { onSubmitted } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/Rate limit exceeded/)).toBeTruthy());
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.queryByText(/Report saved/)).toBeNull();
    // Still submittable — a rate limit is temporary, not a dead end.
    expect(screen.getByRole("button", { name: /submit report/i })).toBeTruthy();
  });

  it("says plainly that nothing was saved when the network fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const { onSubmitted } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/wasn't saved/)).toBeTruthy());
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("does not treat a 2xx with no row as a success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    const { onSubmitted } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/may not have saved/)).toBeTruthy());
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("refuses to submit a shop whose coordinates are unusable", async () => {
    renderForm({ latitude: Number.NaN });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(screen.getByText(/coordinates look invalid/)).toBeTruthy());
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
