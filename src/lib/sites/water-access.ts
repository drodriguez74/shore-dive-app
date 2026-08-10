/**
 * How a diver gets in the water — and, for overhead environments, whether
 * getting in is the dangerous part.
 *
 * `shore-access.ts` answers "can I swim to this from a beach entry" by
 * measuring distance to a catalogued coastal entry point. That model is right
 * for reefs and wrecks and completely wrong for Florida's freshwater springs:
 * you park, walk down steps, and you are in the water. Ginnie Springs, Blue
 * Grotto, Devil's Den, Troy, Rainbow — all no-boat dives, and every one of
 * them scores `unlikely` under a coastal-distance model because the nearest
 * catalogued ocean entry is a hundred miles away. Springs are arguably *more*
 * shore-accessible than any reef in the dataset.
 *
 * ## The part that actually matters
 *
 * Ease of entry and safety of the dive are unrelated here, and conflating
 * them would be the most dangerous mistake this codebase could make.
 *
 * A cave system is trivially easy to enter and can kill an untrained diver.
 * The same Overpass query that returns Ginnie Springs returns **Eagle's Nest**
 * — a ~300 ft cave system with multiple fatalities, reachable by walking down
 * a slope. Presenting that as "walk-in access, no boat needed" alongside a
 * beginner-friendly spring, with nothing else said, would be an invitation.
 *
 * Overhead environments are not a harder version of open-water diving; they
 * are a separate discipline with separate training, and open-water
 * certification is explicitly **not** sufficient for them. That's not this
 * project's opinion — it's the consistent position of every training agency,
 * and the reason cave sites carry warning signage at the entrance. So
 * `AccessType` describes entry, and `OverheadEnvironment` is carried
 * separately and rendered separately, so no caller can surface one while
 * omitting the other.
 */

import type { SiteType } from "./types";

export type AccessType = "walk_in" | "shore_swim" | "boat" | "unknown";

/** Cavern = within the daylight zone, a recognised limited-penetration
 * specialty. Cave = full overhead, requiring full cave certification. The
 * distinction is real and training agencies treat it as such, so the data
 * shouldn't flatten it. */
export type OverheadEnvironment = "none" | "cavern" | "cave";

export interface WaterAccess {
  accessType: AccessType;
  overhead: OverheadEnvironment;
  /** True only when entry requires no boat AND no meaningful surface swim. */
  isWalkIn: boolean;
  /** Renderable, and deliberately never reassuring about overhead sites. */
  summary: string;
  /** Present whenever `overhead !== "none"`. Callers MUST surface this
   * wherever they surface `accessType` — the whole point of separating the
   * two fields is that easy entry must never be shown alone. */
  overheadWarning: string | null;
}

const CAVE_WARNING =
  "Overhead environment — cave diving. This is a separate discipline from open-water diving, " +
  "not a harder version of it: it requires full cave certification, dedicated equipment and " +
  "training in guideline and gas management. Open Water and Advanced Open Water certification " +
  "do not qualify a diver to enter. Divers die in Florida's cave systems every year, and easy " +
  "entry is precisely what makes them dangerous.";

const CAVERN_WARNING =
  "Overhead environment — cavern. Penetration is limited to the daylight zone and requires " +
  "cavern training; going beyond it is cave diving and requires full cave certification. " +
  "Treat the boundary as real, not advisory.";

/**
 * Site types that are entered on foot. These are inland freshwater sites —
 * springs and sinks — where "distance to the nearest ocean entry" is a
 * meaningless measurement rather than a small one.
 */
const WALK_IN_TYPES: ReadonlySet<SiteType> = new Set<SiteType>(["spring", "cave"]);

/**
 * Classifies how a site is entered, from its `site_type`.
 *
 * `cave` in `site_type` is a *geological* classification derived from OSM's
 * `natural=cave_entrance` — it means the site is a cave or spring-cave, not
 * that a given dive there necessarily penetrates the overhead. Some, like
 * Devil's Den, are dived as open-water/cavern sites by recreational divers.
 * That's exactly why `overhead` is returned rather than assumed: the caller
 * shows the warning, and a human can later refine an individual site without
 * this function having to be right about every case.
 *
 * When in doubt this errs toward warning. A spurious cave warning on a benign
 * spring costs a diver ten seconds of reading; a missing one costs
 * considerably more.
 */
export function classifyWaterAccess(siteType: SiteType | null | undefined): WaterAccess {
  if (siteType === "cave") {
    return {
      accessType: "walk_in",
      overhead: "cave",
      isWalkIn: true,
      summary: "Walk-in freshwater site — no boat needed.",
      overheadWarning: CAVE_WARNING,
    };
  }

  if (siteType === "spring") {
    // Florida springs very often have a cavern or cave system at the vent,
    // even where the basin itself is dived by open-water divers. Ginnie
    // Springs' ballroom and Blue Grotto's cavern are the norm, not exceptions.
    return {
      accessType: "walk_in",
      overhead: "cavern",
      isWalkIn: true,
      summary: "Walk-in freshwater spring — no boat needed, typically an easy entry.",
      overheadWarning: CAVERN_WARNING,
    };
  }

  return {
    accessType: "unknown",
    overhead: "none",
    isWalkIn: false,
    summary: "Entry method not determined from site type — see shore access.",
    overheadWarning: null,
  };
}

/** Whether `shore-access.ts`'s coastal-distance model applies at all. It does
 * not for walk-in freshwater sites, where a large "distance to nearest ocean
 * entry" is an artifact of the model rather than a fact about the site. */
export function usesCoastalDistanceModel(siteType: SiteType | null | undefined): boolean {
  return !WALK_IN_TYPES.has(siteType as SiteType);
}
