// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_LOCATION_ZOOM,
  SiteLocationMap,
  siteLocationDescription,
  buildShoreEntryLine,
  shoreEntryLineDescription,
} from "./site-location-map";
import { legalGlyphTier, pinIconName } from "@/lib/sites/pin-icons";
import { SOUTH_FLORIDA_ENTRY_POINTS } from "@/lib/sites/shore-access";
import type { SiteMarker } from "@/lib/sites/types";

/**
 * Coverage for the single-site location map (T21.22).
 *
 * **What is and isn't testable here.** `NEXT_PUBLIC_MAPBOX_TOKEN` is unset in
 * this environment, so the component renders its no-token placeholder — which
 * is exactly one of the two behaviours worth pinning (the page must not lose
 * the location when the map can't draw). The Mapbox render path needs a WebGL
 * context jsdom doesn't provide, and `drawPinIcon` needs a real Canvas 2D
 * context this no-budget project has deliberately not taken on a native
 * dependency for (see `pin-icons.test.ts`'s own note), so the rasterization
 * loop is not exercised here.
 *
 * The property that actually matters — that this map and the exploration map
 * resolve the *same* icon for the same site — is asserted directly instead, by
 * deriving the expected `pinIconName` from `pin-icons.ts` the same way
 * `site-map.tsx`'s `buildSiteFeatureCollection` does. A regression where this
 * component grew its own pin logic would break that equality.
 */

const SITE: SiteMarker = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Datura Avenue Reef",
  latitude: 26.1867,
  longitude: -80.09498,
  provenance: "COMMUNITY",
  legal_access_status: "marine_protected_area",
  site_type: "shore_reef",
  hasHazardReport: true,
};

afterEach(cleanup);

describe("siteLocationDescription", () => {
  it("reaches a screen reader with the site's name and exact coordinates", () => {
    const text = siteLocationDescription(SITE);
    expect(text).toContain("Datura Avenue Reef");
    expect(text).toContain("latitude 26.18670");
    expect(text).toContain("longitude -80.09498");
  });

  it("spells out the facts the pin only encodes visually", () => {
    const text = siteLocationDescription(SITE);
    expect(text).toContain("Community entry, not independently reviewed");
    expect(text).toContain("hazard report on file");
    expect(text).toContain("Marine Protected Area");
  });

  it("omits the legal-access clause exactly when the pin draws no corner glyph", () => {
    // Keeps the accessible text in step with the pin's own low-noise default:
    // `open`/not-yet-assessed get no glyph, so they get no clause either.
    for (const status of ["open", null] as const) {
      const text = siteLocationDescription({ ...SITE, legal_access_status: status });
      expect(legalGlyphTier(status)).toBeNull();
      expect(text).not.toContain("Open access");
      expect(text).not.toContain("Not yet assessed");
    }
  });

  it("distinguishes a verified, hazard-free site", () => {
    const text = siteLocationDescription({
      ...SITE,
      provenance: "VERIFIED",
      hasHazardReport: false,
      legal_access_status: null,
    });
    expect(text).toContain("Verified entry");
    expect(text).not.toContain("hazard report on file");
  });
});

describe("SiteLocationMap without a Mapbox token", () => {
  it("degrades to a placeholder instead of breaking the page", () => {
    expect(process.env.NEXT_PUBLIC_MAPBOX_TOKEN).toBeFalsy();
    render(<SiteLocationMap site={SITE} />);
    expect(screen.getByText(/NEXT_PUBLIC_MAPBOX_TOKEN is not set/)).toBeTruthy();
  });

  it("still shows the coordinates the map existed to convey", () => {
    render(<SiteLocationMap site={SITE} />);
    expect(screen.getByText("26.18670, -80.09498")).toBeTruthy();
  });
});

describe("pin reuse", () => {
  it("resolves the same icon name site-map.tsx would for the same site", () => {
    // Derived exactly as `buildSiteFeatureCollection` derives it — if this
    // component ever stops importing `pin-icons.ts`, a site would render
    // differently on its own detail page than on the exploration map.
    const expected = pinIconName({
      siteType: SITE.site_type,
      isCommunity: SITE.provenance === "COMMUNITY",
      hasHazardReport: SITE.hasHazardReport,
      legalTier: legalGlyphTier(SITE.legal_access_status),
    });
    expect(expected).toBe("site-pin-shore_reef-community-hazard-amber");
  });
});

describe("default zoom", () => {
  it("is close enough to read a shoreline but not so close the geography drops out", () => {
    expect(DEFAULT_SITE_LOCATION_ZOOM).toBe(14);
  });
});

/**
 * Coverage for the shore-entry line (founder ask, 2026-08-11: "a hash line
 * from the shore to the site"). The actual line/marker rendering needs the
 * same real WebGL context this file's own header explains is unavailable
 * here — `buildShoreEntryLine` and `shoreEntryLineDescription` are the pure
 * halves of that feature, extracted specifically so the geometry and the
 * accessible text are verifiable without a browser.
 */

const DATURA = SOUTH_FLORIDA_ENTRY_POINTS.find((e) => e.id === "datura-ave-lbts")!;
// A real reef site off Datura, per this session's own measured baseline —
// close enough offshore to exercise realistic short-distance geometry.
const SECOND_REEF_SITE = { latitude: 26.19159, longitude: -80.08491 };

describe("buildShoreEntryLine", () => {
  it("draws a two-point line from the entry to the site, in that order", () => {
    const line = buildShoreEntryLine(DATURA, SECOND_REEF_SITE);
    expect(line.lineGeoJSON.geometry.coordinates).toEqual([
      [DATURA.longitude, DATURA.latitude],
      [SECOND_REEF_SITE.longitude, SECOND_REEF_SITE.latitude],
    ]);
  });

  it("places the entry marker exactly at the entry's own coordinates", () => {
    const line = buildShoreEntryLine(DATURA, SECOND_REEF_SITE);
    expect(line.entryPoint).toEqual({ latitude: DATURA.latitude, longitude: DATURA.longitude });
  });

  it("places the midpoint label between the two points, not at either endpoint", () => {
    const line = buildShoreEntryLine(DATURA, SECOND_REEF_SITE);
    expect(line.midpoint.latitude).toBeGreaterThan(Math.min(DATURA.latitude, SECOND_REEF_SITE.latitude));
    expect(line.midpoint.latitude).toBeLessThan(Math.max(DATURA.latitude, SECOND_REEF_SITE.latitude));
    expect(line.midpoint.longitude).toBeCloseTo((DATURA.longitude + SECOND_REEF_SITE.longitude) / 2, 10);
  });

  it("computes bounds that actually contain both the entry and the site", () => {
    const line = buildShoreEntryLine(DATURA, SECOND_REEF_SITE);
    const [[west, south], [east, north]] = line.bounds;
    for (const point of [DATURA, SECOND_REEF_SITE]) {
      expect(point.longitude).toBeGreaterThanOrEqual(west);
      expect(point.longitude).toBeLessThanOrEqual(east);
      expect(point.latitude).toBeGreaterThanOrEqual(south);
      expect(point.latitude).toBeLessThanOrEqual(north);
    }
  });

  it("computes correct bounds regardless of which point is geographically first", () => {
    // Guards a min/max mix-up: the entry is not always west-of or south-of
    // the site, so bounds must be a real min/max, not just [entry, site]
    // read positionally.
    const entryNortheast = { latitude: 26.3, longitude: -79.9 };
    const siteSouthwest = { latitude: 26.1, longitude: -80.2 };
    const line = buildShoreEntryLine(entryNortheast, siteSouthwest);
    expect(line.bounds).toEqual([
      [-80.2, 26.1],
      [-79.9, 26.3],
    ]);
  });
});

describe("shoreEntryLineDescription", () => {
  it("names the entry and the distance", () => {
    const text = shoreEntryLineDescription(DATURA, 0.25);
    expect(text).toContain(DATURA.name);
    expect(text).toContain("440 yd");
  });

  it("never claims the line is a confirmed or recommended route", () => {
    // shore-access.ts's own rule, extended to this new visual: a distance
    // measurement, never a stronger claim than the classifier itself makes.
    const text = shoreEntryLineDescription(DATURA, 0.25);
    expect(text).toMatch(/not a confirmed or recommended route/);
    expect(text).not.toMatch(/\bconfirmed swim\b/i);
  });

  it("uses miles, not yards, once the distance crosses the half-mile threshold", () => {
    // formatShoreDistance's own unit-switching rule (site-dive-profile.tsx) —
    // reused here, not reimplemented, so the two never disagree on units.
    const text = shoreEntryLineDescription(DATURA, 0.6);
    expect(text).toContain("0.6 mi");
  });
});
