/**
 * Map site-pin icon system (T21.7, extracted out of `site-map.tsx` by T21.17).
 *
 * This module owns the *icon system* and nothing else: what pin icons exist
 * (`allPinIconSpecs`), what they're called (`pinIconName`), and what they look
 * like (`SITE_PIN_PATH`, `SITE_TYPE_GLYPHS`, `drawPinIcon`). It deliberately
 * knows nothing about Mapbox, React, or GeoJSON — `src/components/site-map.tsx`
 * keeps all of that (rasterizing these specs into `map.addImage` calls, the
 * data-driven `icon-image` expression, event wiring, JSX). The split exists so
 * the icon system can be reasoned about and unit-tested on its own, which
 * matters because a real design pass over these pins is a known upcoming task
 * (plan.md Resolved Decision #7 / creative/AESTHETIC_REVIEW.md — see the
 * "deliberately conservative" note below).
 *
 * Everything below is a verbatim move from `site-map.tsx`, comments included:
 * the reasoning here (especially the legibility fix) is the record of two
 * review lenses' findings and must not be re-derived or quietly dropped.
 */

import type { SiteMarker, SiteType } from "@/lib/sites/types";

// ---------------------------------------------------------------------
// Site pins (Task 11.5, migrated to a GeoJSON Source + symbol Layer by
// T21.7, plan.md Resolved Decision #9) — real `sites` data, per
// creative/flows/map-exploration.md's pin-rendering decision logic:
//   ring   = provenance (VERIFIED / COMMUNITY)
//   fill   = hazard-report presence (sky = none on file, amber = 1+ on
//            file) — informational, never a safety verdict
//   glyph  = legal-access status, shown only for the 4 restricted states
//            (open/null get no glyph — the documented low-noise default)
// A teardrop pin shape distinguishes site markers from the small round
// LDS/fill-station dot in site-map.tsx, on top of the color differences.
//
// LEGIBILITY FIX (2026-08-08 aesthetic review — creative/AESTHETIC_REVIEW.md
// "Map pin system doesn't pass a glance test"): two independent reviews
// found the ring-vs-fill *hue* distinction unreadable at real pin size
// (~30x38px) against the dark navy basemap. The fix applied here: the
// provenance ring is no longer hue-coded at all. It's a single, always
// near-white (`#fafafa`) stroke — maximum contrast against depth-0/navy —
// with VERIFIED vs. COMMUNITY carried by stroke *pattern* (solid vs.
// dashed) instead of by color. Dashed = COMMUNITY reuses the exact
// "dashed = unconfirmed/less-certain" grammar `ProvenanceBadge` already
// established for MODEL_INFERRED, rather than inventing a new convention.
// This also happens to be a better fix for the diver review's separately-
// flagged colorblind-legibility concern than a higher-contrast hue pair
// would have been — a shape/pattern distinction doesn't depend on hue
// discrimination at all. The full-color ProvenanceBadge is still shown the
// moment a pin is tapped (site detail page) — this is only the coarse,
// glance-level pre-tap signal, which is all a map pin needs to carry.
//
// This path is reused as-is by the T21.7 canvas rasterizer below (via
// `Path2D`) — the shape itself, and the reasoning above, are unchanged by
// the Marker→symbol-layer migration. Only *how* it gets onto the map
// changed (one `<Marker>` DOM node per site → a single rasterized icon
// referenced by a data-driven `icon-image` expression on one shared
// symbol layer, Mapbox's own recommended pattern once the OSM import
// pipeline (Task 21) makes hundreds/thousands of site pins a near-term
// reality rather than a hypothetical).
export const SITE_PIN_PATH =
  "M15 1c7.732 0 14 6.268 14 14 0 10.5-14 22-14 22S1 25.5 1 15C1 7.268 7.268 1 15 1z";

/** Severity tier of the legal-access corner glyph, or `null` for "draw no
 * glyph at all". */
export type LegalGlyphTier = "amber" | "rose";

/** Legal-access corner-glyph severity tier — `null` for `open`/not-yet-
 * assessed (no glyph at all, the documented low-noise default), otherwise
 * amber (caution tier: MPA/seasonal closure) or rose (higher-severity tier:
 * private property/restricted-other), matching the legal-access badge's own
 * color logic exactly (`src/components/legal-access-badge.tsx`). */
export function legalGlyphTier(status: SiteMarker["legal_access_status"]): LegalGlyphTier | null {
  switch (status) {
    case "marine_protected_area":
    case "seasonal_closure":
      return "amber";
    case "private_property":
    case "restricted_other":
      return "rose";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------
// T21.7 — site-type icon glyphs (plan.md Resolved Decision #9's
// GeoJSON-source/symbol-layer migration, sequenced with Decision #7's
// per-site-type icons per TASKS.md T21.7's own text: "a symbol layer's
// data-driven icon-image expression is the natural mechanism for
// per-site_type icons ... the shared foundation for both, not a fourth
// independent task").
//
// `SiteType`: landed in `src/lib/sites/types.ts` by T21.5's parallel,
// in-flight pass (`0010_sites_site_type.sql`) partway through this same
// session — imported directly below rather than the local placeholder this
// file started with, since the real enum's 6 values (`shore_reef` /
// `shipwreck` / `cave` / `spring` / `artificial_reef` / `unclassified`)
// turned out to match this task's own placeholder set exactly, so no
// reconciliation was needed beyond swapping the import. `SiteMarker.site_type`
// is now a required, typed field (not nullable, `unclassified` is the
// column's own "no known category" default) — real site data starts
// carrying a real value as T21.5's OSM-tag-derivation half backfills it.
//
// ICON ARTWORK IS DELIBERATELY CONSERVATIVE, NOT A FINAL DESIGN PASS:
// TASKS.md's hold-lifted note for this batch is explicit that "the map's
// actual icon artwork should still lean conservative/placeholder pending a
// real design pass" through creative/AESTHETIC_REVIEW.md — T21.5's own entry
// flags that the pin already carries 3 visual dimensions (provenance ring,
// hazard fill, legal-access corner glyph) and is at real risk of becoming
// unreadable with a 4th bolted on carelessly (the same failure mode the
// T11.5 legibility fix above had to correct away from). The treatment here
// is deliberately restrained: a single small white outline glyph, same
// visual weight for every type, dropped into the existing pin's head — nothing
// added competes for attention with the ring/fill/corner-badge dimensions
// that are already tuned. If a design pass decides this genuinely doesn't
// work at real pin size, that's a real, open possibility — flagged in this
// pass's report rather than asserted as settled.
export const SITE_TYPES: SiteType[] = [
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
];

/** Each glyph is drawn with simple Canvas 2D primitives in a local 24x24
 * coordinate space (stroke only, matching legal-access-badge.tsx's outline-
 * icon language) — hand-drawn, not traced from an icon library, same
 * "inline the six small paths by hand" approach that file already
 * documents choosing over adding a new npm icon dependency. */
export const SITE_TYPE_GLYPHS: Record<SiteType, (ctx: CanvasRenderingContext2D) => void> = {
  shore_reef: (ctx) => {
    // Simple double-wave — reef ridges, not a literal coral illustration.
    ctx.beginPath();
    ctx.moveTo(2, 14);
    ctx.bezierCurveTo(5, 9, 8, 19, 11, 14);
    ctx.bezierCurveTo(14, 9, 17, 19, 20, 14);
    ctx.bezierCurveTo(21, 12.5, 21.5, 12, 22, 11.5);
    ctx.stroke();
  },
  shipwreck: (ctx) => {
    // Anchor motif — a recognizable nautical/wreck placeholder, not a
    // literal sunken-ship illustration.
    ctx.beginPath();
    ctx.arc(12, 5.5, 2.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 7.7);
    ctx.lineTo(12, 20.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6.5, 12.5);
    ctx.lineTo(17.5, 12.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 12.5);
    ctx.bezierCurveTo(5, 17.5, 8, 20.5, 12, 20.5);
    ctx.bezierCurveTo(16, 20.5, 19, 17.5, 19, 12.5);
    ctx.stroke();
  },
  cave: (ctx) => {
    // Arch/doorway — a cave-mouth placeholder.
    ctx.beginPath();
    ctx.moveTo(5, 20.5);
    ctx.lineTo(5, 12);
    ctx.arc(12, 12, 7, Math.PI, 0, false);
    ctx.lineTo(19, 20.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, 20.5);
    ctx.lineTo(21, 20.5);
    ctx.stroke();
  },
  spring: (ctx) => {
    // Droplet.
    ctx.beginPath();
    ctx.moveTo(12, 2.5);
    ctx.bezierCurveTo(12, 2.5, 18.5, 12, 18.5, 16);
    ctx.bezierCurveTo(18.5, 19.6, 15.6, 21.8, 12, 21.8);
    ctx.bezierCurveTo(8.4, 21.8, 5.5, 19.6, 5.5, 16);
    ctx.bezierCurveTo(5.5, 12, 12, 2.5, 12, 2.5);
    ctx.stroke();
  },
  artificial_reef: (ctx) => {
    // Grid/frame — a man-made-structure placeholder.
    ctx.strokeRect(4.5, 4.5, 15, 15);
    ctx.beginPath();
    ctx.moveTo(4.5, 12);
    ctx.lineTo(19.5, 12);
    ctx.moveTo(12, 4.5);
    ctx.lineTo(12, 19.5);
    ctx.stroke();
  },
  unclassified: (ctx) => {
    // Plain circle — deliberately the simplest/neutral shape in the set.
    ctx.beginPath();
    ctx.arc(12, 12, 6.5, 0, Math.PI * 2);
    ctx.stroke();
  },
};

/** The four visual dimensions one rasterized pin icon is keyed by. One spec
 * = one `map.addImage` registration = one `icon-image` id. */
export interface PinIconSpec {
  siteType: SiteType;
  isCommunity: boolean;
  hasHazardReport: boolean;
  legalTier: LegalGlyphTier | null;
}

/** Stable Mapbox `icon-image` id for a spec. Must stay deterministic and
 * collision-free across the whole spec space: `buildSiteFeatureCollection`
 * writes this string into each feature's `icon` property, and the symbol
 * layer's `["get", "icon"]` expression looks up the image registered under
 * exactly this name. */
export function pinIconName(spec: PinIconSpec): string {
  return `site-pin-${spec.siteType}-${spec.isCommunity ? "community" : "verified"}-${
    spec.hasHazardReport ? "hazard" : "clear"
  }-${spec.legalTier ?? "none"}`;
}

export const PIN_WIDTH = 30;
export const PIN_HEIGHT = 38;
export const PIN_RASTER_SCALE = 2; // rasterize at 2x for retina crispness

export function drawPinIcon(ctx: CanvasRenderingContext2D, spec: PinIconSpec): void {
  ctx.clearRect(0, 0, PIN_WIDTH * PIN_RASTER_SCALE, PIN_HEIGHT * PIN_RASTER_SCALE);
  ctx.save();
  ctx.scale(PIN_RASTER_SCALE, PIN_RASTER_SCALE);

  // Teardrop body — same path/reasoning as SITE_PIN_PATH's comment above.
  const body = new Path2D(SITE_PIN_PATH);
  ctx.fillStyle = spec.hasHazardReport ? "#f59e0b" : "#0ea5e9";
  ctx.fill(body);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#fafafa";
  ctx.setLineDash(spec.isCommunity ? [3, 3] : []);
  ctx.stroke(body);
  ctx.setLineDash([]);

  // Site-type glyph, centered in the pin's rounded head.
  ctx.save();
  ctx.translate(15 - 7, 13 - 7);
  ctx.scale(14 / 24, 14 / 24);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  SITE_TYPE_GLYPHS[spec.siteType](ctx);
  ctx.restore();

  // Legal-access corner badge — same color logic as legal-access-badge.tsx.
  if (spec.legalTier) {
    ctx.beginPath();
    ctx.arc(26.5, 3.6, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = spec.legalTier === "amber" ? "#f59e0b" : "#f43f5e";
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = "#fafafa";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 26.5, 4);
  }

  ctx.restore();
}

/** Every icon combination the symbol layer can reference — the full cross
 * product of the four visual dimensions. Enumeration order is the order
 * icons get registered with `map.addImage`; it carries no meaning beyond
 * that, but the *set* must cover every spec `buildSiteFeatureCollection`
 * can produce, or a real site would reference an unregistered image and
 * render as nothing. */
export function allPinIconSpecs(): PinIconSpec[] {
  const specs: PinIconSpec[] = [];
  const legalTiers: Array<LegalGlyphTier | null> = [null, "amber", "rose"];
  for (const siteType of SITE_TYPES) {
    for (const isCommunity of [false, true]) {
      for (const hasHazardReport of [false, true]) {
        for (const legalTier of legalTiers) {
          specs.push({ siteType, isCommunity, hasHazardReport, legalTier });
        }
      }
    }
  }
  return specs;
}
