import Dexie, { type EntityTable } from "dexie";

/**
 * Client-side IndexedDB schema for the Intent-Driven Offline Cache pillar
 * (plan.md Task 12/13). Structured site + hazard data is cached here so a
 * dive site is usable with zero cellular coverage; the service worker
 * (src/app/sw.ts) handles the separate, static-asset half of the same
 * best-effort prefetch story (map tiles, imagery).
 *
 * NOTE (T12.4): the real Postgres schema (P0-B) is being designed in
 * parallel and isn't final yet. These record shapes are deliberately loose —
 * a stable `id`/`cachedAt` envelope around a flexible `data` blob — so this
 * cache layer doesn't have to be rewritten every time the server schema
 * shifts. Tighten `data` once the Postgres schema lands.
 *
 * `cachedAt` is the field the whole freshness/staleness story depends on
 * (THREAT_MODEL.md §2: cached data must never look "as fresh" as it isn't —
 * see src/components/freshness-badge.tsx, which reads this field). Every
 * write path into these tables must set it to the actual time of caching,
 * not a placeholder.
 */

/** Two-state provenance tag (P0-B). `MODEL_INFERRED` is a separate,
 * unrelated tag used elsewhere (Task 18) — not expected on cached
 * site/hazard records, but the type stays loose (`string`) here rather than
 * a closed union, since this cache layer shouldn't hard-fail on whatever
 * value the eventual backend sends. See src/components/provenance-badge.tsx
 * for the UI-facing closed union that does enforce the known values. */
export type CachedProvenance = "VERIFIED" | "COMMUNITY" | string;

export interface CachedSiteRecord {
  /** Site identifier — matches the (eventual) Postgres `sites.id`. */
  id: string;
  name: string;
  provenance?: CachedProvenance;
  /** Flexible JSON blob for whatever site fields the server sends
   * (coordinates, description, access/legal status, etc.). */
  data: Record<string, unknown>;
  /** When this record was written to the local cache — the source of truth
   * for freshness/staleness display. Always a concrete point in time, never
   * inferred from elsewhere. */
  cachedAt: Date;
}

export interface CachedHazardRecord {
  /** Hazard report identifier. */
  id: string;
  /** The site this hazard record applies to. */
  siteId: string;
  name: string;
  provenance?: CachedProvenance;
  data: Record<string, unknown>;
  cachedAt: Date;
}

class ShoreDiveOfflineDB extends Dexie {
  cachedSites!: EntityTable<CachedSiteRecord, "id">;
  cachedHazards!: EntityTable<CachedHazardRecord, "id">;

  constructor() {
    super("shore-dive-offline-cache");
    this.version(1).stores({
      // Indexed on id (primary key) plus the fields we filter/sort by today;
      // add more indexes as real query patterns show up rather than
      // speculatively indexing every field.
      cachedSites: "id, cachedAt",
      cachedHazards: "id, siteId, cachedAt",
    });
  }
}

/**
 * Singleton Dexie instance. Safe to import from a client component at
 * module scope — Dexie only touches the actual `indexedDB` global lazily,
 * on first transaction, so this doesn't throw during server-side rendering
 * (where `indexedDB` doesn't exist). Callers still must not read/write it
 * outside a browser context (e.g. not from a Server Component body).
 */
export const db = new ShoreDiveOfflineDB();
