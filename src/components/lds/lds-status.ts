/**
 * Local Dive Shop (LDS) / fill-station status data model (Task 16, T16.1).
 *
 * Field names/shapes mirror `supabase/migrations/0001_init.sql`'s
 * `lds_status` table exactly (id, site_id, name, latitude, longitude,
 * status, provenance, last_verified_at, created_by, created_at) — real as
 * of `src/lib/sites/queries.ts`'s `listLdsStatusMarkers()` (T22.6), which
 * replaced this module's own hardcoded mock data (`MOCK_LDS_LOG`,
 * `MOCK_LDS_MARKERS`, removed 2026-08-10) after it was found rendering live
 * on the homepage map unconditionally — not a fallback, the only data path
 * that existed for LDS pins. See `lds-status.test.ts` for `latestStatusPerShop`
 * coverage using small local fixtures instead.
 *
 * IMPORTANT — append-only log, not update-in-place: `supabase/README.md`
 * ("lds_status: one table, not a separate dive_shops entity") flags this as
 * a judgment call and *recommends* modeling `lds_status` as an append-only
 * verification log — each confirmation inserts a new row, and "current
 * status for a shop" is the latest row per shop (matched by
 * `site_id`+`name`, since there's no shop-identity FK), mirroring
 * `hazard_reports`. `latestStatusPerShop()` below is the client-side
 * equivalent of the `select distinct on (...) ... order by
 * last_verified_at desc` query the README calls out as the real Postgres
 * access pattern, applied to `listLdsStatusMarkers()`'s real read.
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

export const LDS_STATUS_LABEL: Record<LdsStatusValue, string> = {
  open: "Open",
  closed: "Closed",
  limited: "Limited air",
  unknown: "Status unknown",
};
