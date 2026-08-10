// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearbyDiveSitesList, type NearbyDiveSitesListProps } from "./nearby-dive-sites-list";
import type { SiteMarker } from "@/lib/sites/types";

/**
 * Regression coverage for the founder-reported bug (2026-08-10): "click the
 * dive site filters and eventually nothing works, even ones that worked
 * before." Root cause was structural, not a filter-logic bug: this component
 * used to render `SiteTypeFilterRow`/`DifficultyFilterRow` from TWO separate
 * `return` statements (one for `!coords`, one for `coords` resolved) —
 * different JSX trees React can't reconcile in place, so the instant
 * `coords` resolved (asynchronously — can land mid-click), React tore down
 * the whole `!coords` tree, filter buttons included, and mounted a fresh one.
 * Confirmed live: an automated rapid-click pass caught a window where zero
 * matching filter buttons existed in the DOM right after a geolocation
 * resolution landed mid-sequence.
 *
 * The fix collapses both branches into one stable tree. The test that would
 * have caught the original bug is `does NOT unmount the filter buttons when
 * coords resolves` below — it captures the literal DOM node before the
 * transition and asserts the same node is still attached after.
 */

function site(overrides: Partial<SiteMarker> = {}): SiteMarker {
  return {
    id: "site-1",
    name: "Test Reef",
    latitude: 26.1,
    longitude: -80.1,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "shore_reef",
    hasHazardReport: false,
    ...overrides,
  };
}

const BASE_PROPS: NearbyDiveSitesListProps = {
  sites: [site()],
  status: "pending",
  coords: null,
  radiusMiles: 25,
  onRadiusChange: vi.fn(),
  radiusOptions: [25, 50, 100, 250, Infinity],
  isSearching: false,
  inRadius: [],
  searchedExternally: false,
  siteTypeFilter: "all",
  onSiteTypeFilterChange: vi.fn(),
  difficultyFilter: "all",
  onDifficultyFilterChange: vi.fn(),
  isSignedIn: false,
};

afterEach(cleanup);

describe("NearbyDiveSitesList — the structural fix itself", () => {
  it("does NOT unmount the filter buttons when coords resolves mid-session", () => {
    const { rerender, container } = render(<NearbyDiveSitesList {...BASE_PROPS} coords={null} />);

    const beforeButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reef");
    expect(beforeButton).toBeTruthy();

    // The exact transition that broke it: coords goes from null to resolved,
    // asynchronously, exactly like the real `useGeolocation` effect firing.
    rerender(
      <NearbyDiveSitesList
        {...BASE_PROPS}
        coords={{ latitude: 26.1, longitude: -80.1 }}
        inRadius={[{ site: BASE_PROPS.sites[0], miles: 1.2 }]}
      />,
    );

    const afterButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reef");
    expect(afterButton).toBeTruthy();
    // The regression check: literally the same DOM node, not a lookalike
    // rendered fresh after an unmount/remount cycle.
    expect(afterButton).toBe(beforeButton);
    expect(afterButton?.isConnected).toBe(true);
  });

  it("does NOT unmount the filter buttons when coords is lost (resolved -> null)", () => {
    // The reverse transition matters too — same reconciliation risk either
    // direction, and nothing in the original bug pinned it to only one.
    const { rerender, container } = render(
      <NearbyDiveSitesList
        {...BASE_PROPS}
        coords={{ latitude: 26.1, longitude: -80.1 }}
        inRadius={[{ site: BASE_PROPS.sites[0], miles: 1.2 }]}
      />,
    );
    const beforeButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reef");
    expect(beforeButton).toBeTruthy();

    rerender(<NearbyDiveSitesList {...BASE_PROPS} coords={null} />);

    const afterButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reef");
    expect(afterButton).toBe(beforeButton);
  });

  it("preserves filter selection across the coords transition", () => {
    const { rerender } = render(<NearbyDiveSitesList {...BASE_PROPS} coords={null} siteTypeFilter="cave" />);
    expect(screen.getByRole("button", { name: "Cave" }).getAttribute("aria-pressed")).toBe("true");

    rerender(
      <NearbyDiveSitesList
        {...BASE_PROPS}
        coords={{ latitude: 26.1, longitude: -80.1 }}
        siteTypeFilter="cave"
        inRadius={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Cave" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("NearbyDiveSitesList — header and controls vary correctly with coords", () => {
  it("shows the location-agnostic header and hides the radius select before coords resolve", () => {
    render(<NearbyDiveSitesList {...BASE_PROPS} coords={null} status="unavailable" />);
    expect(screen.getByText("Dive sites")).toBeTruthy();
    expect(screen.queryByText("Within")).toBeNull();
    expect(screen.getByText(/Enable location access/)).toBeTruthy();
  });

  it("shows the location-aware header and the radius select once coords resolve", () => {
    render(
      <NearbyDiveSitesList
        {...BASE_PROPS}
        coords={{ latitude: 26.1, longitude: -80.1 }}
        inRadius={[{ site: BASE_PROPS.sites[0], miles: 1.2 }]}
      />,
    );
    expect(screen.getByText("Dive sites near you")).toBeTruthy();
    expect(screen.getByText("Within")).toBeTruthy();
  });
});

describe("NearbyDiveSitesList — empty states stay honest across both coords states", () => {
  it("names the active filter before coords resolve, without a radius mention", () => {
    render(<NearbyDiveSitesList {...BASE_PROPS} coords={null} sites={[]} siteTypeFilter="cave" />);
    expect(screen.getByText(/No cave sites on file yet\./)).toBeTruthy();
  });

  it("names the radius once coords resolve and the radius-filtered set is empty", () => {
    render(<NearbyDiveSitesList {...BASE_PROPS} coords={{ latitude: 26.1, longitude: -80.1 }} inRadius={[]} />);
    expect(screen.getByText(/No dive sites within 25 mi of your location yet/)).toBeTruthy();
  });

  it("returns null (renders nothing) when there are no sites at all and no filter is active", () => {
    const { container } = render(<NearbyDiveSitesList {...BASE_PROPS} coords={null} sites={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
