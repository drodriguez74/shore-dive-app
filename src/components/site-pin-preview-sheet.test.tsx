// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SitePinPreviewSheet } from "./site-pin-preview-sheet";
import type { SiteMarker } from "@/lib/sites/types";

afterEach(cleanup);

function marker(overrides: Partial<SiteMarker> = {}): SiteMarker {
  return {
    id: "site-1",
    name: "Sunset Reef",
    latitude: 26.1867,
    longitude: -80.09498,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "shore_reef",
    hasHazardReport: false,
    ...overrides,
  };
}

describe("SitePinPreviewSheet", () => {
  it("shows the site name and a link to the full detail page", () => {
    render(<SitePinPreviewSheet site={marker()} onClose={vi.fn()} />);
    expect(screen.getByText("Sunset Reef")).toBeTruthy();
    const link = screen.getByRole("link", { name: /View full site/ });
    expect(link.getAttribute("href")).toBe("/sites/site-1");
  });

  it("calls onClose when the close button is activated", () => {
    const onClose = vi.fn();
    render(<SitePinPreviewSheet site={marker()} onClose={onClose} />);
    screen.getByLabelText("Close preview").click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders a depth stat when depth is known", () => {
    render(<SitePinPreviewSheet site={marker({ depth_min_ft: 15, depth_max_ft: 30 })} onClose={vi.fn()} />);
    expect(screen.getByText("15–30 ft")).toBeTruthy();
  });

  it("renders a single value when min and max depth are equal", () => {
    render(<SitePinPreviewSheet site={marker({ depth_min_ft: 20, depth_max_ft: 20 })} onClose={vi.fn()} />);
    expect(screen.getByText("20 ft")).toBeTruthy();
  });

  it("omits the depth stat entirely when depth is unrecorded, rather than showing a blank or zero", () => {
    render(<SitePinPreviewSheet site={marker()} onClose={vi.fn()} />);
    expect(screen.queryByText("Depth")).toBeNull();
  });

  it("shows a hazard stat only when the site actually has one", () => {
    const { rerender } = render(<SitePinPreviewSheet site={marker({ hasHazardReport: true })} onClose={vi.fn()} />);
    expect(screen.getByText("Reported")).toBeTruthy();

    rerender(<SitePinPreviewSheet site={marker({ hasHazardReport: false })} onClose={vi.fn()} />);
    expect(screen.queryByText("Reported")).toBeNull();
  });

  it("shows the shore-access preview label without overclaiming confirmation", () => {
    render(<SitePinPreviewSheet site={marker({ shore_access: "marginal" })} onClose={vi.fn()} />);
    // Consistent with shore-access.ts's own rule: never render as confirmed.
    expect(screen.getByText(/Shore-accessible/)).toBeTruthy();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  });

  it("never renders 'unlikely' as boat-access-only — found 2026-08-10, this used to say 'Boat access likely'", () => {
    // shore-access.ts's own rule, violated here until this fix: `unlikely`
    // is also the honest answer for a site whose entry nobody has
    // catalogued yet, not a finding that it's boat-only. A compact preview
    // sheet has no room for that nuance, so the fix is to show nothing.
    render(<SitePinPreviewSheet site={marker({ shore_access: "unlikely" })} onClose={vi.fn()} />);
    expect(screen.queryByText(/[Bb]oat/)).toBeNull();
    expect(screen.queryByText(/Shore-accessible/)).toBeNull();
    expect(screen.queryByText(/Plausibly shore-accessible/)).toBeNull();
  });
});
