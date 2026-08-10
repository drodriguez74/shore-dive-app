/**
 * Provenance badge (P0-B.5) — every pin/hazard/LDS status must carry a
 * visible, visually-distinct provenance tag, never a bare/undifferentiated
 * badge (plan.md's Map-Driven Exploration pillar, THREAT_MODEL.md §1/§8).
 *
 * v1 only ever assigns `VERIFIED` or `COMMUNITY` (the two-state model in
 * P0-B). `MODEL_INFERRED` is included in the type now, with its own visual
 * treatment and an optional confidence score, so this component doesn't
 * need a breaking rework when Task 18's webcam vision pipeline lands — but
 * nothing in this codebase wires it up yet; it's forward-compat only.
 */

export type Provenance = "VERIFIED" | "COMMUNITY" | "MODEL_INFERRED";

export interface ProvenanceBadgeProps {
  provenance: Provenance;
  /** 0–1. Only meaningful (and only rendered) for `MODEL_INFERRED`. */
  confidence?: number;
  className?: string;
}

const PROVENANCE_META: Record<Provenance, { label: string; icon: string; title: string; classes: string }> = {
  VERIFIED: {
    label: "Verified",
    icon: "✓",
    title: "Confirmed by an authoritative or explicitly-verified source",
    classes:
      "border-sky-600/40 bg-sky-500/10 text-sky-800 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300",
  },
  COMMUNITY: {
    label: "Community",
    icon: "◐",
    title: "Submitted by the community — not independently verified",
    classes:
      "border-violet-600/30 bg-violet-500/10 text-violet-800 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-300",
  },
  MODEL_INFERRED: {
    label: "Model estimate",
    icon: "✦",
    title: "Estimated by an AI model from source imagery — not a verified reading",
    // Dashed border reinforces "estimate, not a confirmed fact" at a glance,
    // distinct from both the solid Verified and Community treatments.
    classes:
      "border-dashed border-zinc-500/50 bg-zinc-500/10 text-zinc-700 dark:border-zinc-400/40 dark:bg-zinc-400/10 dark:text-zinc-300",
  },
};

export function ProvenanceBadge({ provenance, confidence, className = "" }: ProvenanceBadgeProps) {
  const meta = PROVENANCE_META[provenance];

  return (
    <span
      title={meta.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.classes} ${className}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
      {provenance === "MODEL_INFERRED" && typeof confidence === "number" && (
        <span className="opacity-75">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}
