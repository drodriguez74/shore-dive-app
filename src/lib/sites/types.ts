/**
 * Shared types for the `sites`/`hazard_reports` real-data layer (Task 11.5).
 * Field names/shapes mirror `supabase/migrations/0001_init.sql` exactly, the
 * same "match the eventual server schema, don't invent one" convention
 * `src/lib/db.ts` and `src/components/lds/lds-status.ts` already follow.
 */

import type { Provenance } from "@/components/provenance-badge";
import type { ShoreAccessConfidence, ShoreAccessMethod } from "./shore-access";

/** `sites`/`hazard_reports` only ever carry the two-state provenance model
 * (P0-B) — narrowed here for the same reason `src/components/lds/lds-status.ts`
 * narrows `LdsProvenance`: `MODEL_INFERRED` must never accidentally flow into
 * this table's data. */
export type SiteProvenance = Extract<Provenance, "VERIFIED" | "COMMUNITY">;

/** Matches the `legal_access_status` Postgres enum exactly, including the
 * nullable "not yet assessed" state — see `src/components/legal-access-badge.tsx`. */
export type LegalAccessStatus =
  | "open"
  | "marine_protected_area"
  | "seasonal_closure"
  | "private_property"
  | "restricted_other"
  | null;

/** Matches the `site_type` Postgres enum exactly (T21.5,
 * `0010_sites_site_type.sql`, plan.md Resolved Decision #7) — what kind of
 * site this is, for map-icon rendering. Not nullable: `unclassified` is
 * the column's own "no known category" default, so there's no separate
 * null state to model here (unlike `LegalAccessStatus`). This is the exact
 * type name/shape the map-icon-rendering half of T21.5 (a parallel,
 * in-flight piece — see TASKS.md) is built against; keep the 6 string
 * values stable. */
export type SiteType =
  | "shore_reef"
  | "shipwreck"
  | "cave"
  | "spring"
  | "artificial_reef"
  | "unclassified";

/**
 * The `shore_access` Postgres enum (`0012_sites_dive_metadata.sql`), which is
 * `ShoreAccessConfidence` from `./shore-access` — re-exported through the DB
 * type surface rather than redeclared, so the stored column and the
 * classifier that produces it can never drift apart into two independently
 * edited string unions. A type-only import, so none of that module's runtime
 * data (`SOUTH_FLORIDA_ENTRY_POINTS`) is pulled in by importing this file.
 *
 * The DB column is additionally nullable, and that null is a third real
 * state: **not yet classified**, distinct from `"unlikely"` ("classified,
 * no catalogued entry in range"). See the migration's column comment —
 * `"unlikely"` must never be rendered as "boat access only", since it is
 * also the honest answer for a site reachable from an entry nobody has
 * catalogued yet.
 */
export type { ShoreAccessConfidence };

/**
 * The `shore_access_method` Postgres enum (`0014_shore_access_method.sql`),
 * re-exported the same way as `ShoreAccessConfidence` above — the stored
 * column and the classifier that produces it must never drift apart. `null`
 * whenever `shore_access` is `null` (not yet classified). See
 * `ShoreAccessMethod`'s own doc comment for what `"curated_entry"` vs.
 * `"osm_tag"` may claim — an `osm_tag` row is real but unverified, and must
 * never be rendered with the same weight as a researched, cited entry.
 */
export type { ShoreAccessMethod };

/** One citation backing a `Site.research_summary` (`0013_sites_research_summary.sql`,
 * Task 22) — `title` is the source's own name (a dive shop, a park
 * authority, a citizen-science chapter), not a generic "source 1" label, so
 * a diver can judge who's actually vouching for the claim. */
export interface ResearchSource {
  title: string;
  url: string;
}

/** One row of `sites`, coordinates coerced to `number` (PostgREST can
 * return Postgres `numeric` columns as JSON strings to avoid float
 * precision loss — see `src/lib/sites/queries.ts`'s `toNumber` helper,
 * which every fetch path routes through so callers never have to guard
 * against a `string`/`number` union themselves). */
export interface Site {
  id: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  provenance: SiteProvenance;
  legal_access_status: LegalAccessStatus;
  site_type: SiteType;
  /**
   * Depth range **in feet** (`0012_sites_dive_metadata.sql`) — feet because
   * that is what the source catalogues and the certification limits in
   * `./dive-suitability` are both expressed in. `min` is the *shallowest
   * divable* depth (a wreck's deck), not a bounding-box minimum: that is
   * what `classifyDiveSuitability()` classifies on.
   *
   * `null` means **not recorded**, never zero and never "too deep" — most
   * catalogue records genuinely carry no depth, and
   * `classifyDiveSuitability()` deliberately answers "Depth not recorded"
   * rather than inventing a certification level. Optional (`?`) as well as
   * nullable so every existing consumer of `Site` still compiles untouched;
   * `queries.ts` always populates both explicitly, so an absent key only
   * ever comes from a hand-built object, not from a real read.
   */
  depth_min_ft?: number | null;
  depth_max_ft?: number | null;
  /** Derived shore-access confidence, or `null`/absent for "not yet
   * classified" — see the `ShoreAccessConfidence` re-export above for why
   * that is a distinct state from `"unlikely"`. */
  shore_access?: ShoreAccessConfidence | null;
  /** Which signal produced `shore_access` — see the `ShoreAccessMethod`
   * re-export above. `null`/absent alongside a `null` `shore_access`. */
  shore_access_method?: ShoreAccessMethod | null;
  /** `ShoreEntryPoint.id` the classification was measured from (e.g.
   * `"south-beach-5th-st"`). Detail-page only — it exists so the UI can say
   * "295 yd from the 5th Street beach entry" instead of showing an
   * unexplained badge, and so a re-classification against a grown entry list
   * is auditable. Not a foreign key: the entry points are a curated constant
   * in `./shore-access`, not a table, so a slug that no longer resolves must
   * degrade to showing the distance alone — never to inventing a name. */
  shore_entry_id?: string | null;
  /** Distance **in yards** from `shore_entry_id` to this site. Yards, not the
   * miles `classifyShoreAccess()` returns, because this is a number shown
   * directly to a diver deciding whether to make the swim. Populated for
   * `"unlikely"` rows too, when a nearest entry exists — that is exactly the
   * case where "why was this ruled out" is worth answering. */
  shore_distance_yards?: number | null;
  /** Original-synthesis web-research summary (`0013_sites_research_summary.sql`,
   * Task 22) — distinct from `description`, which is verbatim/near-verbatim
   * from the upstream catalogue. `null` means no research pass has covered
   * this site yet (the overwhelming majority of rows in v1 scope — see
   * `TASKS.md` T22). Must always render with an explicit "AI-assisted web
   * research, not independently verified" disclosure, same standing rule as
   * `shore_access`. */
  research_summary?: string | null;
  /** Citations backing `research_summary`, written and read as a unit with
   * it — `null` in lockstep with a `null` summary. See `ResearchSource`. */
  research_sources?: ResearchSource[] | null;
  /** When `research_summary`/`research_sources` were last written by a
   * research pass — a freshness signal distinct from the generic
   * `updated_at` (which bumps on any column change, including an unrelated
   * `shore_access` fix). Render as "per research as of [date]", never a
   * bare/binary "researched" badge — same discipline as offline-cache
   * freshness. `null` means not yet researched. */
  research_summary_updated_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of `hazard_reports`. */
export interface HazardReport {
  id: string;
  site_id: string;
  provenance: SiteProvenance;
  description: string;
  reported_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lightweight shape for map-pin rendering (`src/components/site-map.tsx`) —
 * deliberately not the full `Site` row. `hasHazardReport` is a derived
 * boolean (any hazard_reports row on file, not a severity/count signal —
 * see `creative/flows/map-exploration.md`'s pin-rendering rationale: "has
 * any report vs. none" is informational, never a safety verdict).
 *
 * **What earned a place here, and what didn't** (`0012_sites_dive_metadata.sql`).
 * This shape is fetched for *every pin in the viewport* (up to
 * `DEFAULT_SITE_QUERY_LIMIT` rows), so the bar is "does the map itself need
 * it", not "is it interesting":
 *
 * - `depth_min_ft`/`depth_max_ft` — yes. Depth is not decoration on a map
 *   for recreational divers; `./dive-suitability` names
 *   `entirelyBeyondRecreational` as "the signal to exclude it from a
 *   recreational map rather than merely tag it". Filtering pins by
 *   certification level is a map-level operation, and doing it without depth
 *   per pin would mean an N+1 detail fetch just to decide what to draw.
 * - `shore_access` — yes. This app is specifically about shore diving, so
 *   "shore-diveable only" is its most likely non-geographic pin filter. One
 *   nullable enum.
 * - `shore_entry_id`/`shore_distance_yards` — no, `Site` only. These are the
 *   *explanation* ("295 yd from the 5th Street beach entry"), which is prose
 *   for one selected site, not something the map needs to place, colour or
 *   filter a pin. Carrying a slug plus a number across several hundred pins
 *   to render one line of text on the one that gets opened is exactly the
 *   bloat this type exists to avoid.
 */
export interface SiteMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  provenance: SiteProvenance;
  legal_access_status: LegalAccessStatus;
  site_type: SiteType;
  /** Depth range **in feet**; `null` means not recorded. See `Site` for the
   * full semantics — same columns, same "unknown is not zero" rule. Present
   * on the marker so certification-level filtering is a map-level decision
   * rather than a per-pin detail fetch. Optional so existing `SiteMarker`
   * literals (mock/demo data in components) still compile untouched. */
  depth_min_ft?: number | null;
  depth_max_ft?: number | null;
  /** Derived shore-access confidence; `null`/absent means not yet
   * classified. Present on the marker for shore-access pin filtering — but
   * without `shore_entry_id`/`shore_distance_yards`, so any pin-level
   * rendering of this must be a filter or an unelaborated tag, with the
   * "295 yd from ..." explanation coming from the detail read. */
  shore_access?: ShoreAccessConfidence | null;
  /** Which signal produced `shore_access` — present on the marker (unlike
   * `shore_entry_id`/`shore_distance_yards`, detail-only) since a future
   * "curated entries only" map filter would need it per-pin, same
   * reasoning `shore_access` itself earned a place here in 0012. */
  shore_access_method?: ShoreAccessMethod | null;
  hasHazardReport: boolean;
}
