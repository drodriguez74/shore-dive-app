import type { SiteType } from "./types";

/**
 * Human-readable labels for `SiteType` (Task 21, T21.5's data layer +
 * this filter-by-type follow-up, 2026-08-09). Shared, standalone module
 * (not folded into `site-map.tsx`, which owns the icon *glyphs*) so a
 * plain list/filter UI can use these labels without importing a
 * map-rendering component.
 */
export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  shore_reef: "Reef",
  shipwreck: "Shipwreck",
  cave: "Cave",
  spring: "Spring",
  artificial_reef: "Artificial reef",
  unclassified: "Unclassified",
};

/** Stable display order — matches `site-map.tsx`'s `SITE_TYPES` list. */
export const SITE_TYPE_OPTIONS: SiteType[] = [
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
];
