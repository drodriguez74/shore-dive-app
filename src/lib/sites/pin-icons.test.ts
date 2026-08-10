import { describe, expect, it } from "vitest";
import {
  allPinIconSpecs,
  legalGlyphTier,
  pinIconName,
  PIN_HEIGHT,
  PIN_RASTER_SCALE,
  PIN_WIDTH,
  SITE_TYPES,
  SITE_TYPE_GLYPHS,
  type LegalGlyphTier,
  type PinIconSpec,
} from "./pin-icons";
import type { LegalAccessStatus, SiteType } from "./types";

/**
 * Pure-logic coverage for the map pin icon system (T21.17).
 *
 * DELIBERATELY NOT TESTED HERE: `drawPinIcon()`. It needs a real Canvas 2D
 * context (`Path2D`, `getContext("2d")`) — this suite runs in vitest's `node`
 * environment, and even under jsdom, canvas support requires an extra native
 * dependency (`node-canvas`) that this no-budget project hasn't taken on.
 * Pixel-level assertions on hand-drawn glyph artwork would also be exactly the
 * kind of brittle test that has to be rewritten by the upcoming design pass
 * (plan.md Resolved Decision #7) without ever having caught a real bug. What
 * *is* covered below is the part that can silently break the map without
 * looking broken in code review: icon naming, spec enumeration, and the
 * glyph/tier lookup tables that `drawPinIcon` indexes into.
 */

/** Every value of the `LegalAccessStatus` union, `null` included. Listed
 * explicitly (not derived) so that adding a status to the type without adding
 * it here is a compile error, not a silently-skipped case. */
const ALL_LEGAL_ACCESS_STATUSES: LegalAccessStatus[] = [
  "open",
  "marine_protected_area",
  "seasonal_closure",
  "private_property",
  "restricted_other",
  null,
];

/** Same treatment for `SiteType` — an exhaustive, hand-listed set that fails
 * to compile if the union grows. */
const ALL_SITE_TYPES: SiteType[] = [
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
];

const ALL_LEGAL_TIERS: Array<LegalGlyphTier | null> = [null, "amber", "rose"];

describe("legalGlyphTier", () => {
  it("maps the two caution-tier statuses to amber", () => {
    expect(legalGlyphTier("marine_protected_area")).toBe("amber");
    expect(legalGlyphTier("seasonal_closure")).toBe("amber");
  });

  it("maps the two higher-severity statuses to rose", () => {
    expect(legalGlyphTier("private_property")).toBe("rose");
    expect(legalGlyphTier("restricted_other")).toBe("rose");
  });

  // The low-noise default the pin system is built around: a glyph appears
  // only for the 4 genuinely restricted states. `open` and "not yet assessed"
  // (null) must be indistinguishable on the pin — an unassessed site must
  // never render as if someone had checked and cleared it, and an open site
  // must never carry a caution mark.
  it("yields no glyph for both `open` and `null` (the documented low-noise default)", () => {
    expect(legalGlyphTier("open")).toBeNull();
    expect(legalGlyphTier(null)).toBeNull();
  });

  it("returns a valid tier or null for every LegalAccessStatus value", () => {
    for (const status of ALL_LEGAL_ACCESS_STATUSES) {
      expect(ALL_LEGAL_TIERS).toContain(legalGlyphTier(status));
    }
  });

  it("classifies exactly 4 of the 6 statuses as restricted", () => {
    const glyphed = ALL_LEGAL_ACCESS_STATUSES.filter((status) => legalGlyphTier(status) !== null);
    expect(glyphed).toEqual([
      "marine_protected_area",
      "seasonal_closure",
      "private_property",
      "restricted_other",
    ]);
  });
});

describe("SITE_TYPE_GLYPHS", () => {
  // A missing entry means `drawPinIcon` calls `undefined(ctx)` and throws
  // mid-rasterization, taking out icon generation for the whole map — or, if
  // it were ever made optional, renders a blank pin with no site-type signal.
  it("has a glyph for every SiteType value", () => {
    for (const siteType of ALL_SITE_TYPES) {
      expect(typeof SITE_TYPE_GLYPHS[siteType]).toBe("function");
    }
  });

  it("has no extra glyph entries beyond the SiteType union", () => {
    expect(Object.keys(SITE_TYPE_GLYPHS).sort()).toEqual([...ALL_SITE_TYPES].sort());
  });

  // SITE_TYPES drives the icon *enumeration*; SITE_TYPE_GLYPHS drives what
  // each one draws. If these two drift apart, either a site type gets no
  // registered icon (renders as nothing on the map) or an icon is registered
  // that nothing can draw.
  it("covers exactly the same set of site types SITE_TYPES enumerates", () => {
    expect([...SITE_TYPES].sort()).toEqual(Object.keys(SITE_TYPE_GLYPHS).sort());
  });
});

describe("pinIconName", () => {
  it("is deterministic for the same spec", () => {
    const spec: PinIconSpec = {
      siteType: "shipwreck",
      isCommunity: true,
      hasHazardReport: false,
      legalTier: "rose",
    };
    expect(pinIconName(spec)).toBe(pinIconName({ ...spec }));
  });

  it("encodes all four visual dimensions in the name", () => {
    expect(
      pinIconName({
        siteType: "cave",
        isCommunity: true,
        hasHazardReport: true,
        legalTier: "amber",
      }),
    ).toBe("site-pin-cave-community-hazard-amber");

    expect(
      pinIconName({
        siteType: "shore_reef",
        isCommunity: false,
        hasHazardReport: false,
        legalTier: null,
      }),
    ).toBe("site-pin-shore_reef-verified-clear-none");
  });

  it("produces a unique name for every spec in the full space", () => {
    const names = allPinIconSpecs().map(pinIconName);
    expect(new Set(names).size).toBe(names.length);
  });

  // A collision would be silent and wrong in the worst way: two different
  // pin meanings resolving to one registered image, so (say) a hazard-flagged
  // site renders with the clear-conditions icon. `map.addImage` is skipped for
  // an already-registered name, so whichever spec rasterized first would win.
  it("never collides across any two distinct specs", () => {
    const specs = allPinIconSpecs();
    const byName = new Map<string, PinIconSpec>();
    for (const spec of specs) {
      const name = pinIconName(spec);
      const existing = byName.get(name);
      expect(existing, `name collision on "${name}"`).toBeUndefined();
      byName.set(name, spec);
    }
  });

  // The name is written into each GeoJSON feature's `icon` property and read
  // back by the symbol layer's `["get", "icon"]` expression. Mapbox looks the
  // image up by exact string, so anything goes in principle — but keeping the
  // ids to a conservative charset avoids quoting/escaping surprises if the
  // expression is ever built by concatenation instead of a property lookup.
  it("produces ids safe to use in a Mapbox icon-image expression", () => {
    for (const name of allPinIconSpecs().map(pinIconName)) {
      expect(name).toMatch(/^[a-z0-9_-]+$/);
      expect(name.startsWith("site-pin-")).toBe(true);
      expect(name).not.toContain("undefined");
      expect(name).not.toContain("null");
      expect(name).not.toContain("[object");
    }
  });
});

describe("allPinIconSpecs", () => {
  // Count is derived from the input dimensions, never hardcoded: if a fifth
  // visual dimension (or a seventh site type) is added, this stays honest
  // instead of failing against a stale magic number.
  it("enumerates the full cross product of every visual dimension", () => {
    const expected = SITE_TYPES.length * 2 /* provenance */ * 2 /* hazard */ * ALL_LEGAL_TIERS.length;
    expect(allPinIconSpecs()).toHaveLength(expected);
  });

  it("contains no duplicate specs", () => {
    const keys = allPinIconSpecs().map(
      (spec) => `${spec.siteType}|${spec.isCommunity}|${spec.hasHazardReport}|${spec.legalTier}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every site type an equal number of times", () => {
    const specs = allPinIconSpecs();
    for (const siteType of ALL_SITE_TYPES) {
      expect(specs.filter((spec) => spec.siteType === siteType)).toHaveLength(
        specs.length / SITE_TYPES.length,
      );
    }
  });

  it("covers both provenance states, both hazard states, and all three legal tiers", () => {
    const specs = allPinIconSpecs();
    expect(new Set(specs.map((spec) => spec.isCommunity))).toEqual(new Set([false, true]));
    expect(new Set(specs.map((spec) => spec.hasHazardReport))).toEqual(new Set([false, true]));
    expect(new Set(specs.map((spec) => spec.legalTier))).toEqual(new Set(ALL_LEGAL_TIERS));
  });

  // The map registers one image per spec up front, then every rendered site
  // looks its icon up by name. Any real site whose (type × provenance ×
  // hazard × legal status) combination is missing from this enumeration would
  // reference an unregistered image and render as nothing at all — an
  // invisible dive site, which is the failure mode that actually matters.
  it("covers every icon name a real site marker could resolve to", () => {
    const registered = new Set(allPinIconSpecs().map(pinIconName));
    for (const siteType of ALL_SITE_TYPES) {
      for (const provenance of ["VERIFIED", "COMMUNITY"] as const) {
        for (const hasHazardReport of [false, true]) {
          for (const status of ALL_LEGAL_ACCESS_STATUSES) {
            const name = pinIconName({
              siteType,
              isCommunity: provenance === "COMMUNITY",
              hasHazardReport,
              legalTier: legalGlyphTier(status),
            });
            expect(registered.has(name), `no icon registered for "${name}"`).toBe(true);
          }
        }
      }
    }
  });
});

describe("pin raster dimensions", () => {
  // Not aesthetics: these feed the offscreen canvas size and the `pixelRatio`
  // handed to `map.addImage`, so a non-positive or fractional scale would
  // produce a broken or blurry registration rather than a visibly wrong pin.
  it("are positive integers", () => {
    for (const value of [PIN_WIDTH, PIN_HEIGHT, PIN_RASTER_SCALE]) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("keeps the teardrop taller than it is wide", () => {
    expect(PIN_HEIGHT).toBeGreaterThan(PIN_WIDTH);
  });
});
