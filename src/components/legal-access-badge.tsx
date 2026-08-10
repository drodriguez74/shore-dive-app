/**
 * Legal/access-status badge (Task 11.5) — renders `sites.legal_access_status`
 * (nullable enum: `open` | `marine_protected_area` | `seasonal_closure` |
 * `private_property` | `restricted_other` | `null`).
 *
 * Deliberately a SEPARATE badge family from `ProvenanceBadge`
 * (`src/components/provenance-badge.tsx`), per `creative/flows/map-exploration.md`:
 * provenance answers "who vouches for this data," this answers "can I
 * legally dive here" — two orthogonal, both-important axes that must never
 * be visually confused with each other. Same pill shape/sizing as
 * `ProvenanceBadge` so the two read as one badge family side by side;
 * different color logic and outline-icon glyphs instead of `ProvenanceBadge`'s
 * text glyphs (✓ ◐ ✦), per DESIGN_SYSTEM.md §5's icon language.
 *
 * The `null` ("not yet assessed") state deliberately reuses the exact
 * dashed-border grammar `ProvenanceBadge` already established for
 * `MODEL_INFERRED` ("unconfirmed, not a settled fact") — same underlying
 * meaning, so the same visual pattern, not a new one invented for this file.
 *
 * Built icon-for-icon and color-for-color from the approved reference sheet:
 * `creative/mockups/map-exploration/07-legal-access-badge-reference.html`.
 * Icon paths are inlined by hand (matching that mockup's raw SVG, which is
 * itself hand-copied Lucide iconography) rather than pulling in the
 * `lucide-react` package — DESIGN_SYSTEM.md names Lucide as the icon system,
 * but it isn't an installed dependency anywhere in this codebase yet
 * (`ProvenanceBadge` uses plain text glyphs), and adding a new npm
 * dependency isn't this task's call to make unilaterally per CLAUDE.md's "no
 * paid dependency without checking" standard — even though `lucide-react` is
 * free, inlining the six small paths this one component needs avoids that
 * decision entirely while still matching the approved reference exactly.
 */

import type { ReactNode } from "react";
import type { LegalAccessStatus } from "@/lib/sites/types";

export type { LegalAccessStatus };

export interface LegalAccessBadgeProps {
  status: LegalAccessStatus;
  className?: string;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  open: (
    <Icon>
      <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4z" />
      <polyline points="9,12 11,14 15,10" />
    </Icon>
  ),
  marine_protected_area: (
    <Icon>
      <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </Icon>
  ),
  seasonal_closure: (
    <Icon>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="14" x2="15" y2="18" />
      <line x1="15" y1="14" x2="9" y2="18" />
    </Icon>
  ),
  private_property: (
    <Icon>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  ),
  restricted_other: (
    <Icon>
      <path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
    </Icon>
  ),
  unassessed: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 1 1 4 2.8c-.7.3-1.1.9-1.1 1.7" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </Icon>
  ),
};

const LEGAL_ACCESS_META: Record<string, { label: string; title: string; classes: string }> = {
  open: {
    label: "Open access",
    title: "Confirmed — checked, no restriction found",
    classes:
      "border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  marine_protected_area: {
    label: "Marine Protected Area",
    title: "Caution — diving is often still allowed, check the rules",
    classes:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
  },
  seasonal_closure: {
    label: "Seasonal closure",
    title: "Caution — time-bound restriction, check current dates",
    classes:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
  },
  private_property: {
    label: "Private property",
    title: "Access requires explicit permission",
    classes:
      "border-rose-600/40 bg-rose-500/10 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300",
  },
  restricted_other: {
    label: "Access restricted",
    title: "A restriction applies for a reason not covered above",
    classes:
      "border-rose-600/40 bg-rose-500/10 text-rose-800 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300",
  },
  unassessed: {
    label: "Not yet assessed",
    title: "Distinct from Open access — nobody has checked this site's legal/access status yet",
    classes:
      "border-dashed border-zinc-500/50 bg-zinc-500/10 text-zinc-700 dark:border-zinc-400/40 dark:bg-zinc-400/10 dark:text-zinc-300",
  },
};

/** Plain-text label for a status — reused by the map pin's aria-label
 * (`src/components/site-map.tsx`) so the accessible name matches this
 * badge's own text exactly, without duplicating the label list. */
export function legalAccessLabel(status: LegalAccessStatus): string {
  return LEGAL_ACCESS_META[status ?? "unassessed"].label;
}

export function LegalAccessBadge({ status, className = "" }: LegalAccessBadgeProps) {
  const key = status ?? "unassessed";
  const meta = LEGAL_ACCESS_META[key];

  return (
    <span
      title={meta.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.classes} ${className}`}
    >
      {ICONS[key]}
      <span>{meta.label}</span>
    </span>
  );
}
