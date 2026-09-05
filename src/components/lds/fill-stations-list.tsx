"use client";

import { useMemo, useState } from "react";
import { useGeolocation } from "@/hooks/use-geolocation";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { ClaimListing } from "@/components/lds/claim-listing";
import { LastVerifiedBadge } from "@/components/lds/last-verified-badge";
import { LdsSubmissionForm } from "@/components/lds/lds-submission-form";
import {
  LDS_STATUS_LABEL,
  latestStatusPerShop,
  sortFillStations,
  type LdsStatusRow,
  type LdsStatusValue,
} from "@/components/lds/lds-status";

/**
 * The real "Fill Stations & Gear" list (`creative/mockups/lds-moderation/
 * 01-lds-status-list.html`) — closes a real gap found in the 2026-08-13 UX
 * audit (`TASKS.md` T25, dive-shop-owner persona): LDS status was only ever
 * reachable via a small map pin's popup, buried among dive-site pins, with
 * no dedicated page a diver could browse or a shop owner could point
 * customers to.
 *
 * Client component (not the page itself) because it needs `useGeolocation`
 * for optional distance sorting/display and per-row local toggle state for
 * the report form — the page (`src/app/fill-stations/page.tsx`) stays a
 * plain Server Component doing the real data fetch, same split every other
 * flow in this app already uses.
 */

const ROW_DOT_CLASSES: Record<LdsStatusValue, string> = {
  open: "bg-emerald-500 border-emerald-700",
  closed: "bg-rose-500 border-rose-700",
  limited: "bg-amber-500 border-amber-700",
  unknown: "bg-zinc-400 border-zinc-600",
};

const ROW_STATUS_TEXT_CLASSES: Record<LdsStatusValue, string> = {
  open: "text-emerald-700 dark:text-emerald-400",
  closed: "text-rose-700 dark:text-rose-400",
  limited: "text-amber-700 dark:text-amber-400",
  unknown: "text-zinc-500 dark:text-zinc-400",
};

export interface FillStationsListProps {
  markers: LdsStatusRow[];
  /** Resolved server-side by `src/app/fill-stations/page.tsx`. Passed down
   * to each row's report form so a signed-out diver sees a sign-in prompt
   * up front instead of filling out a report that can't be filed
   * (`lds_status`' insert policy is granted `to authenticated`). */
  isSignedIn?: boolean;
}

export function FillStationsList({ markers, isSignedIn = false }: FillStationsListProps) {
  const { coords } = useGeolocation();

  /** The server-rendered markers plus any report filed in this session.
   * Held as a log, not as a replacement map, so it can be collapsed with
   * exactly the same `latestStatusPerShop` the server read uses — a report
   * for a shop whose current row is somehow newer therefore can't win by
   * being last-written, only by being genuinely later-verified.
   *
   * Same "merge the POSTed row into local state rather than refetching"
   * pattern as `dive-site-explorer.tsx`'s `handleCandidateAdded`: without
   * it, a diver files a report and the row above the form still shows the
   * old status until a manual reload — which reads exactly like the bug
   * this whole change fixed. Initial props are the mount-time value only;
   * a fresh server render (this page is `force-dynamic`) remounts this
   * component and re-seeds it. */
  const [submitted, setSubmitted] = useState<LdsStatusRow[]>([]);

  const current = useMemo(
    () => (submitted.length === 0 ? markers : latestStatusPerShop([...markers, ...submitted])),
    [markers, submitted],
  );

  const sorted = useMemo(() => sortFillStations(current, coords), [current, coords]);

  if (markers.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No fill stations or emergency gear reported yet. Community and shop reports will show up here as they
        come in.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
        Status is community- and shop-reported, never a live feed. This app doesn&apos;t verify status itself —
        it may be wrong or outdated. A dot color is a quick read only — provenance and last-verified time below
        are what tell you whether to trust it before you plan air refills around it.
      </p>
      <ul className="flex flex-col gap-2">
        {sorted.map(({ marker, miles }) => (
          <FillStationRow
            key={marker.id}
            marker={marker}
            miles={miles}
            isSignedIn={isSignedIn}
            onSubmitted={(row) => setSubmitted((prev) => [...prev, row])}
          />
        ))}
      </ul>
    </div>
  );
}

function FillStationRow({
  marker,
  miles,
  isSignedIn,
  onSubmitted,
}: {
  marker: LdsStatusRow;
  miles: number | null;
  isSignedIn: boolean;
  onSubmitted: (row: LdsStatusRow) => void;
}) {
  const [reporting, setReporting] = useState(false);

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-depth-border dark:bg-depth-1">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${ROW_DOT_CLASSES[marker.status]}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="truncate text-sm font-semibold text-black dark:text-zinc-50">{marker.name}</span>
            {miles !== null && (
              <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-500">
                {miles.toFixed(1)} mi
              </span>
            )}
          </div>
          <div className={`mt-0.5 text-xs font-medium ${ROW_STATUS_TEXT_CLASSES[marker.status]}`}>
            {LDS_STATUS_LABEL[marker.status]}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <ProvenanceBadge provenance={marker.provenance} />
            <LastVerifiedBadge lastVerifiedAt={marker.last_verified_at} />
          </div>

          {reporting ? (
            <div className="mt-2.5">
              <LdsSubmissionForm
                siteId={marker.site_id}
                shopName={marker.name}
                latitude={marker.latitude}
                longitude={marker.longitude}
                isSignedIn={isSignedIn}
                onSubmitted={onSubmitted}
                onClose={() => setReporting(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="mt-2 min-h-[24px] text-xs font-semibold text-violet-700 hover:underline dark:text-violet-400"
            >
              Report a status update
            </button>
          )}

          {/* Task 16 / plan.md v5: the only place a shop owner can learn the
              manual VERIFIED claim process exists at all. Rendered per row
              (not once per page) because a claim is about one specific
              listing, and deliberately at the lowest visual weight on the
              row — it's a disclosure for the rare shop-owner visitor, not
              a call to action competing with the diver-facing report link. */}
          <ClaimListing shopName={marker.name} className="mt-2" />
        </div>
      </div>
    </li>
  );
}
