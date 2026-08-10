/**
 * "How hard is this dive?" — the single field a diver actually scans for.
 *
 * Everything this composes already exists and is independently correct in
 * isolation: `classifyDiveSuitability` (depth vs. training limits),
 * `classifyWaterAccess` (overhead environment), `classifyShoreAccess` (swim
 * distance). None of them, alone, answer "beginner, intermediate, or
 * advanced" — that requires combining them, and the combination is where the
 * real danger of this feature lives.
 *
 * ## Why this is a separate module and not a UI-layer combination
 *
 * A component could call all three classifiers and eyeball a label together
 * ad hoc, and the first version of that would almost certainly get the
 * dominance order wrong: depth is the most familiar risk axis to a
 * recreational diver, so it's tempting to average it with everything else.
 * But overhead environment does not average — a 20 ft cavern-fronted spring is
 * not "medium risk" because 20 ft is shallow. Cave presence overrides every
 * other input and forces `technical` outright, unconditionally, regardless of
 * depth or entry. That rule has to live in one tested place, not be
 * re-derived correctly by every caller.
 *
 * ## What this does and does not claim
 *
 * Same standing rule as every other classifier in this codebase (CLAUDE.md):
 * never imply a guarantee the system can't back. This is a composite of three
 * *measurements* — depth, overhead geology, swim distance — none of which
 * include the things that actually decide whether a given dive is hard on a
 * given day: current, surf, visibility, boat traffic, a diver's own fitness.
 * `level` and `riskScore` are read as "how demanding this site typically is
 * from what we can measure", never as "you are cleared to dive this" or "this
 * is safe today". `riskFactors` exists specifically so the label is never
 * shown as an unexplained verdict — every contributing measurement is named.
 */

import { classifyDiveSuitability, type DepthRangeFt } from "./dive-suitability";
import { classifyShoreAccess, type ShoreAccessResult } from "./shore-access";
import { classifyWaterAccess } from "./water-access";
import type { LatLng } from "./distance";
import type { SiteType } from "./types";

export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "technical";

export const DIFFICULTY_LABEL: Record<DifficultyLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  technical: "Technical",
};

export interface DiveDifficulty {
  /** `null` when there isn't enough measured signal to say anything —
   * distinct from `beginner`, which is a claim, not a default. */
  level: DifficultyLevel | null;
  /** 1 (easiest measured profile) to 5 (cave diving, or the deepest
   * technical sites) — a sort/filter key, not a precision instrument. */
  riskScore: number;
  /** Every measurement that contributed, in the order it was applied. Always
   * rendered alongside `level` — a level with no visible factors reads as an
   * opaque verdict, which is exactly what this module exists to avoid. */
  riskFactors: string[];
  /** One line, honest about what was and wasn't measured. */
  summary: string;
}

const MAX_RISK_SCORE = 5;

/**
 * Composite difficulty from depth, overhead environment, and shore-swim
 * distance. Any input can be partially unknown (no depth, no catalogued shore
 * entry) — this degrades gracefully rather than guessing, following the same
 * discipline as the three classifiers it wraps.
 */
export function classifyDiveDifficulty(
  site: LatLng,
  depth: DepthRangeFt,
  siteType: SiteType | null | undefined,
): DiveDifficulty {
  const suitability = classifyDiveSuitability(depth);
  const water = classifyWaterAccess(siteType);
  const shore: ShoreAccessResult = classifyShoreAccess(site);

  const factors: string[] = [];

  // Overhead environment first and decided outright: cave presence is not a
  // point on the same scale as depth or swim distance, it's a different kind
  // of risk entirely, and no combination of shallow-and-close should be able
  // to outvote it.
  if (water.overhead === "cave") {
    return {
      level: "technical",
      riskScore: MAX_RISK_SCORE,
      riskFactors: [
        "Cave diving — a separate discipline requiring full cave certification, regardless of depth",
      ],
      summary: "Technical — cave diving. Open Water and Advanced Open Water certification do not apply here.",
    };
  }

  const haveDepth = suitability.minimumLevel !== null;
  const haveOverhead = water.overhead === "cavern";
  const haveShore = shore.distanceMiles !== null;

  if (!haveDepth && !haveOverhead) {
    // Cavern alone is enough signal to say *something* (see below); with
    // neither depth nor overhead data there is nothing to combine, and a
    // guessed level would outrank real classifiers' own restraint on exactly
    // this point.
    return {
      level: null,
      riskScore: 0,
      riskFactors: [],
      summary: "Not enough recorded data (depth, overhead environment) to assess difficulty.",
    };
  }

  let score = 0;

  if (suitability.entirelyBeyondRecreational) {
    score = MAX_RISK_SCORE;
    factors.push(`Depth beyond the recreational limit (${suitability.summary})`);
  } else if (suitability.minimumLevel === "deep_specialty") {
    score += 3;
    factors.push(`Deep-specialty depth range (${suitability.summary})`);
  } else if (suitability.minimumLevel === "advanced_open_water") {
    score += 2;
    factors.push(`Advanced Open Water depth range (${suitability.summary})`);
  } else if (suitability.minimumLevel === "open_water") {
    score += 1;
    factors.push(`Open Water depth range (${suitability.summary})`);
  }

  if (water.overhead === "cavern") {
    score += 1;
    factors.push("Cavern environment present — limited-penetration training recommended");
  }

  if (haveShore && shore.isShoreAccessible && shore.confidence === "marginal") {
    score += 1;
    factors.push("Extended shore swim (~20–30 min surface swim each way) rather than a short entry");
  }

  score = Math.min(score, MAX_RISK_SCORE);

  let level: DifficultyLevel;
  if (suitability.entirelyBeyondRecreational) {
    level = "technical";
  } else if (score <= 1) {
    level = "beginner";
  } else if (score === 2) {
    level = "intermediate";
  } else {
    level = "advanced";
  }

  const summary = haveDepth
    ? `${DIFFICULTY_LABEL[level]} — based on ${factors.length} measured factor${factors.length === 1 ? "" : "s"}. Conditions on the day (current, visibility, surf) matter more than this label.`
    : `${DIFFICULTY_LABEL[level]} — based on overhead environment only; depth is not recorded. Conditions on the day matter more than this label.`;

  return { level, riskScore: score, riskFactors: factors, summary };
}
