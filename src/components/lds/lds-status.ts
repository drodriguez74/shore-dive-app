/**
 * Local Dive Shop (LDS) / fill-station status data model (Task 16, T16.1).
 *
 * Field names/shapes mirror `supabase/migrations/0001_init.sql`'s
 * `lds_status` table exactly (id, site_id, name, latitude, longitude,
 * status, provenance, last_verified_at, created_by, created_at) so this
 * module doesn't need a rework once a live Supabase project exists — only
 * the fetch/write plumbing changes.
 *
 * IMPORTANT — append-only log, not update-in-place: `supabase/README.md`
 * ("lds_status: one table, not a separate dive_shops entity") flags this as
 * a judgment call and *recommends* modeling `lds_status` as an append-only
 * verification log — each confirmation inserts a new row, and "current
 * status for a shop" is the latest row per shop (matched by
 * `site_id`+`name`, since there's no shop-identity FK), mirroring
 * `hazard_reports`. This module follows that recommendation: `MOCK_LDS_LOG`
 * below is a flat append-only log (including one shop with two rows, to
 * prove the derivation actually works, not just accept single-row input),
 * and `latestStatusPerShop()` is the client-side equivalent of the
 * `select distinct on (...) ... order by last_verified_at desc` query the
 * README calls out as the real Postgres access pattern once this is live.
 * Any future fetch layer should replace `MOCK_LDS_LOG` with a real query,
 * not change the shape callers consume.
 */

import type { Provenance } from "@/components/provenance-badge";

/** Matches the `lds_status.status` check constraint exactly. */
export type LdsStatusValue = "open" | "closed" | "limited" | "unknown";

/**
 * `lds_status` only ever carries the two-state provenance model (P0-B) —
 * the Postgres `provenance_state` enum has no `MODEL_INFERRED` value (see
 * `supabase/README.md`). Narrowed here even though `ProvenanceBadge`
 * accepts the wider `Provenance` union, so a `MODEL_INFERRED` value can
 * never accidentally flow into LDS data.
 */
export type LdsProvenance = Extract<Provenance, "VERIFIED" | "COMMUNITY">;

/** One row of `lds_status`, exactly as the migration defines it. */
export interface LdsStatusRow {
  id: string;
  /** Nullable — a shop isn't necessarily co-located with a documented site. */
  site_id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  status: LdsStatusValue;
  provenance: LdsProvenance;
  /** ISO timestamp — when this row's status was confirmed true. */
  last_verified_at: string;
  /** Nullable — de-attributed if the submitter's account is later deleted. */
  created_by: string | null;
  created_at: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

/**
 * Mock append-only verification log, standing in for a real `lds_status`
 * table query (no live Supabase project yet — same pattern as
 * `src/app/page.tsx`'s `MOCK_CACHED_SITES` and `pretrip-checklist.tsx`'s
 * `MOCK_PLAN`). Coordinates are near the map's default center (La Jolla
 * Cove, San Diego).
 *
 * "lds-1" deliberately has two rows: an older `COMMUNITY` report that the
 * shop was closed, superseded by a fresher `VERIFIED` confirmation that
 * it's open again — this is the append-only shape in action, and
 * `latestStatusPerShop()` below must resolve it to just the newer row.
 */
export const MOCK_LDS_LOG: LdsStatusRow[] = [
  {
    id: "lds-1-r1",
    site_id: null,
    name: "La Jolla Dive & Kayak",
    latitude: 32.828,
    longitude: -117.2717,
    status: "closed",
    provenance: "COMMUNITY",
    last_verified_at: new Date(now - 22 * HOUR).toISOString(),
    created_by: null,
    created_at: new Date(now - 22 * HOUR).toISOString(),
  },
  {
    id: "lds-1-r2",
    site_id: null,
    name: "La Jolla Dive & Kayak",
    latitude: 32.828,
    longitude: -117.2717,
    status: "open",
    provenance: "VERIFIED",
    last_verified_at: new Date(now - 2 * HOUR).toISOString(),
    created_by: null,
    created_at: new Date(now - 2 * HOUR).toISOString(),
  },
  {
    id: "lds-2-r1",
    site_id: null,
    name: "OB Pier Dive Supply",
    latitude: 32.748,
    longitude: -117.251,
    status: "limited",
    provenance: "COMMUNITY",
    last_verified_at: new Date(now - 20 * HOUR).toISOString(),
    created_by: null,
    created_at: new Date(now - 20 * HOUR).toISOString(),
  },
  {
    id: "lds-3-r1",
    site_id: null,
    name: "Cove Lifeguard O2 Cache",
    latitude: 32.8508,
    longitude: -117.2757,
    status: "unknown",
    provenance: "COMMUNITY",
    last_verified_at: new Date(now - 3 * DAY).toISOString(),
    created_by: null,
    created_at: new Date(now - 3 * DAY).toISOString(),
  },
];

/** Shop identity key: `site_id` if set, else `name` — matches the README's
 * "matched by site_id+name, since there's no shop-identity FK" note. */
function shopKey(row: LdsStatusRow): string {
  return row.site_id ?? row.name;
}

/**
 * Client-side equivalent of `select distinct on (site_id, name) ... order
 * by last_verified_at desc` — collapses the append-only log down to one
 * "current status" row per shop, the latest `last_verified_at` wins.
 */
export function latestStatusPerShop(log: LdsStatusRow[]): LdsStatusRow[] {
  const latestByShop = new Map<string, LdsStatusRow>();

  for (const row of log) {
    const key = shopKey(row);
    const existing = latestByShop.get(key);
    if (!existing || new Date(row.last_verified_at).getTime() > new Date(existing.last_verified_at).getTime()) {
      latestByShop.set(key, row);
    }
  }

  return Array.from(latestByShop.values());
}

/** Ready-to-render marker data: mock log collapsed to current status. */
export const MOCK_LDS_MARKERS: LdsStatusRow[] = latestStatusPerShop(MOCK_LDS_LOG);

export const LDS_STATUS_LABEL: Record<LdsStatusValue, string> = {
  open: "Open",
  closed: "Closed",
  limited: "Limited air",
  unknown: "Status unknown",
};
