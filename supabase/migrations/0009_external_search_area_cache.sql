-- 0009_external_search_area_cache.sql
-- Shore Dive — Task 21 (T21.3): per-area ~30-day Overpass fair-use cache.
--
-- Cooldown corrected same-day from an original 24h spec to ~30 days (see
-- plan.md's "Amended same day (2026-08-08)" note on Resolved Decision #6):
-- dive site *locations* don't change day-to-day, so a 24h TTL just re-hits
-- Overpass for the same area daily for near-certainly identical results.
-- This migration's schema (a timestamp column compared against a window)
-- doesn't encode the window length itself — that lives in application code
-- (src/lib/sites/external-search-cache.ts's COOLDOWN_HOURS, currently
-- 30 * 24) — so this correction only touches this file's comments, not its
-- DDL.
--
-- Separate file from 0008_sites_external_source.sql (judgment call, per
-- T21.1/T21.3's brief, which left "fold into 0008 or a separate 0009" open):
-- 0008 changes an existing table's shape (`sites`), this migration adds a
-- brand-new, single-purpose table with its own RLS story — keeping them
-- apart matches this project's established convention of one small,
-- self-contained, reviewable change per migration (CLAUDE.md's "batch
-- discipline") rather than mixing "alter an existing table" with "create a
-- new one" in the same file. Also keeps the numbering unambiguous if T21.1
-- and T21.3 ever need independent review/rollback.
--
-- Why this table exists: plan.md v5 Resolved Decision #6 / Task 21 is
-- explicit that Overpass's public instance (overpass-api.de) has a real
-- fair-use policy, not a formality — the on-demand search route
-- (src/app/api/sites/search-nearby/route.ts) must not call it more than
-- once per rough geographic area per cooldown window (~30 days — see the
-- header note above), no matter how many users search that same area in
-- the meantime. This table is that cooldown
-- ledger: one row per (external_source, coarse grid cell), stamped with the
-- last time that cell was actually searched externally.
--
-- "Coarse grid cell", not exact coordinate: two searches 500ft apart must
-- not each count as a new area (Task 21's own wording). The search route
-- rounds the query's (lat, lng) to the nearest 0.5 degree before reading or
-- writing this table (~34mi/~55km per cell at the equator, narrower in
-- longitude at higher latitudes — coarse on purpose, this is a rate-limit
-- key, not a precise geofence).
--
-- NOT YET APPLIED to any live project — same status as every other file in
-- this directory (see supabase/README.md "How to apply"). No dependency on
-- 0008 beyond both being about Task 21; safe to apply in either order
-- relative to it, though numeric order (0008 then 0009) is the natural one.

create table external_search_area_cache (
  id uuid primary key default gen_random_uuid(),
  -- Same short-slug convention as sites.external_source (0008) — 'osm'
  -- today, room for a second external source later without a schema
  -- change. Part of the uniqueness key so two different external sources
  -- searching the "same" grid cell get independent cooldowns.
  external_source text not null,
  -- Grid cell coordinates: the query (lat, lng) rounded to the nearest 0.5
  -- degree by the search route before it ever reaches this table (see
  -- header comment). numeric, not the sites table's numeric(9,6) — this is
  -- a coarse bucket key, not a precise coordinate, so a couple of decimal
  -- places is all that's meaningful.
  grid_lat numeric(5, 2) not null check (grid_lat between -90 and 90),
  grid_lng numeric(6, 2) not null check (grid_lng between -180 and 180),
  last_searched_at timestamptz not null default now()
);

comment on table external_search_area_cache is
  'Per-area cooldown ledger gating how often the on-demand Overpass '
  'fallback (src/app/api/sites/search-nearby/route.ts, T21.3) may call '
  'the external API for a given rough geographic area. One row per '
  '(external_source, coarse grid cell); last_searched_at is compared '
  'against a ~30-day window (see src/lib/sites/external-search-cache.ts) '
  'before a new external call is allowed. Not public-read data — see the '
  'RLS section below.';

comment on column external_search_area_cache.grid_lat is
  'The search query''s latitude rounded to the nearest 0.5 degree by the '
  'caller before writing here — a rate-limit bucket key, not a precise '
  'coordinate. Two searches a few hundred feet apart land in the same '
  'cell on purpose.';

comment on column external_search_area_cache.grid_lng is
  'Same rounding convention as grid_lat — see that column''s comment.';

-- One row per (source, cell): a repeat search of the same area updates
-- last_searched_at on the existing row rather than accumulating duplicate
-- rows, which keeps "is this area on cooldown" a single indexed lookup.
create unique index external_search_area_cache_cell_idx
  on external_search_area_cache (external_source, grid_lat, grid_lng);

-- Supports the route's "has this cell been searched within the cooldown
-- window" check, which filters on last_searched_at directly.
create index external_search_area_cache_last_searched_at_idx
  on external_search_area_cache (last_searched_at);

-- ---------------------------------------------------------------------
-- Row-Level Security — service-role-only, no public policy at all
-- ---------------------------------------------------------------------
-- Unlike sites/hazard_reports/lds_status/webcam_readings, this table has
-- no public-read purpose whatsoever — it's internal rate-limit bookkeeping
-- for the search route's server-side logic, not map/hazard content a diver
-- would ever look at directly. The search route (a server route handler)
-- reads and writes it via the service-role client
-- (src/lib/supabase/admin.ts), the same escape hatch every other
-- automated-write path in this schema already uses. RLS is enabled with no
-- policies at all (not even a public-read one) — anon/authenticated get no
-- access by omission, same "deny by default, no matching policy" posture
-- 0007_dive_plans.sql documents for its own no-anon-policy stance, applied
-- here even more strictly (dive_plans at least grants owner-only access to
-- authenticated users; this table grants nothing to anon or authenticated
-- at all, since there is no legitimate owner-facing use case for it).
alter table external_search_area_cache enable row level security;

-- Deliberately no `grant` to anon/authenticated and no policies for them —
-- see the comment block above. The service-role key bypasses RLS (and
-- table-level grants) entirely, which is the only access path this table
-- needs.
