import type { CameraSourceStatus } from "@/lib/camera-sources/types";

/**
 * Status badge for the `camera_sources.status` moderation gate
 * (`pending_review` / `approved` / `rejected`, T19.2).
 *
 * Deliberately a separate, small component — NOT `src/components/
 * provenance-badge.tsx`'s `ProvenanceBadge`. That component's own header
 * comment scopes it to the `VERIFIED`/`COMMUNITY`/`MODEL_INFERRED`
 * provenance vocabulary (P0-B / Map-Driven Exploration pillar), a different
 * axis from this table's moderation-queue status. Styled to match its
 * visual weight (rounded-full border-pill) for consistency, but is its own
 * component with its own vocabulary.
 */

export interface CameraSourceStatusBadgeProps {
  status: CameraSourceStatus;
  className?: string;
}

const STATUS_META: Record<CameraSourceStatus, { label: string; icon: string; title: string; classes: string }> = {
  pending_review: {
    label: "Pending review",
    icon: "…",
    title: "Candidate awaiting human review — not usable/embeddable yet",
    classes:
      "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  },
  approved: {
    label: "Approved",
    icon: "✓",
    title: "Reviewed and approved — trusted, safe to render",
    classes:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  rejected: {
    label: "Rejected",
    icon: "✕",
    title: "Reviewed and declined — kept for audit/dedup, never treated as trusted",
    classes:
      "border-rose-600/30 bg-rose-500/10 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300",
  },
};

export function CameraSourceStatusBadge({ status, className = "" }: CameraSourceStatusBadgeProps) {
  const meta = STATUS_META[status];

  return (
    <span
      title={meta.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.classes} ${className}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}
