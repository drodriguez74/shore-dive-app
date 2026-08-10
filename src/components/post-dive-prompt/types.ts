/**
 * Shared types for the Post-Dive Micro-Prompt Engine's condition-logging UI
 * (→ TASKS.md T14.2). Deliberately lightweight — this is the "micro" prompt
 * from plan.md's Task 14, not the full structured logbook entry described
 * under the separate Frictionless Voice Logging pillar (max depth, runtime,
 * etc.). Keep new fields here rare and quick-tap-able; if it needs a text
 * field or a multi-step form, it belongs in the voice-logging feature, not
 * here.
 */

export type VisibilityRating = "poor" | "fair" | "good" | "excellent";

export type CurrentStrength = "none" | "mild" | "moderate" | "strong";

export const VISIBILITY_OPTIONS: { value: VisibilityRating; label: string }[] = [
  { value: "poor", label: "Poor" },
  { value: "fair", label: "Fair" },
  { value: "good", label: "Good" },
  { value: "excellent", label: "Excellent" },
];

export const CURRENT_OPTIONS: { value: CurrentStrength; label: string }[] = [
  { value: "none", label: "None" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "strong", label: "Strong" },
];

/** A single quick-tap submission from the post-dive prompt. */
export interface PostDiveConditionLog {
  id: string;
  /** When the log was submitted (client clock). */
  loggedAt: number;
  /** Which dive site this pertains to, if known. Null when there's no active dive-plan/site context (e.g. a manual demo log). */
  siteId: string | null;
  visibility: VisibilityRating | null;
  current: CurrentStrength | null;
  /** Null = not answered, not "no sighting" — the field is optional and skippable. */
  sawNotableMarineLife: boolean | null;
  /** How the prompt that produced this entry was opened — useful for tuning the trigger logic later. */
  source: "dive-plan-check-in" | "safe-return-checked-in" | "manual";
}

/** The shape of a log before it's assigned an id/timestamp. */
export type PostDiveConditionLogDraft = Omit<PostDiveConditionLog, "id" | "loggedAt">;
