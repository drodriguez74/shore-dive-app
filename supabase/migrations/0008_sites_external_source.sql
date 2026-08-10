-- 0008_sites_external_source.sql
-- Shore Dive — Task 21 (T21.1): external dive-site data sourcing, schema
-- half.
--
-- plan.md v5 Resolved Decision #6 / Task 21 resolves the "sites has only 3
-- founder-seeded rows and no insert path for anyone" gap with an on-demand,
-- cache-then-serve pattern against OpenStreetMap's Overpass API: when a
-- user searches an area with little/no local `sites` data, an Overpass
-- query runs for that area, results are normalized and imported into
-- `sites` as COMMUNITY provenance (T21.2, src/lib/sites/osm-import.ts), and
-- the next person searching that same area gets an instant local read
-- instead of a repeat external call (T21.3,
-- src/app/api/sites/search-nearby/route.ts).
--
-- This migration adds the two columns that make an imported row traceable
-- back to its OSM source and preventable from being re-imported twice.
--
-- No RLS change: `sites` already has no self-service insert policy for this
-- kind of automated write (see 0002_rls.sql — self-service inserts are
-- capped at provenance = 'COMMUNITY' and always require created_by =
-- auth.uid(), neither of which fits an unattended import job). This
-- pipeline writes via the service-role client
-- (src/lib/supabase/admin.ts), exactly the same escape hatch every other
-- automated-write path in this schema already uses (camera_sources
-- approve/reject, webcam_readings inserts) — not a new self-service RLS
-- policy.
--
-- NOT YET APPLIED to any live project — same status as every other file in
-- this directory (see supabase/README.md "How to apply"). Safe to apply any
-- time after 0001_init.sql (the only migration that creates `sites`).

-- ---------------------------------------------------------------------
-- sites.external_source / sites.external_id
-- ---------------------------------------------------------------------
-- Both nullable: the 3 founder-seeded rows (seed.sql) and any future
-- manually-entered or community-submitted site have no external source at
-- all — this pair of columns only ever gets populated for rows the OSM
-- import pipeline itself writes. `external_source` is a short slug
-- ('osm' today) rather than a free-text string so a future second external
-- source (see supabase/sources/dive-site-data-source-options.md's other
-- options, none currently used) can be distinguished from OSM imports
-- without a schema change — just a new value in this column, not a new
-- column.
alter table sites add column external_source text;
alter table sites add column external_id text;

comment on column sites.external_source is
  'Short slug identifying the automated import source (e.g. ''osm'' for '
  'OpenStreetMap/Overpass, Task 21). NULL for founder-seeded and '
  'human-submitted rows, which have no external source at all.';

comment on column sites.external_id is
  'The source system''s own stable identifier for this record (e.g. an '
  'OSM node id, as a string). Paired with external_source in the unique '
  'index below so the same upstream record is never imported twice. NULL '
  'whenever external_source is NULL.';

-- ---------------------------------------------------------------------
-- Uniqueness: the same (external_source, external_id) pair is never
-- imported twice
-- ---------------------------------------------------------------------
-- Partial (WHERE both non-null) rather than a plain two-column unique
-- index for clarity of intent — this constraint only means something for
-- externally-imported rows, and a plain unique index over two nullable
-- columns already behaves this way in Postgres by default (distinct NULLs
-- never conflict with each other), so the WHERE clause here is
-- documentation as much as behavior: it makes the "this only applies to
-- external rows" intent explicit to a future reader rather than relying on
-- NULL-comparison semantics being understood implicitly.
--
-- Implementation note (src/lib/sites/osm-import.ts): because this is a
-- *partial* index, it cannot be used as a plain `ON CONFLICT (col1, col2)`
-- target via the Supabase/PostgREST upsert() helper without also supplying
-- the index's WHERE predicate, which that client API doesn't expose. The
-- import pipeline works around this with a pre-check-then-insert flow
-- (query for already-imported external_ids first, insert only the rest)
-- rather than relying on upsert()'s conflict handling — see that file's
-- header comment for the full reasoning. This index is still the source of
-- truth that makes duplicate prevention correct under a race (a concurrent
-- insert past the pre-check fails with a real unique_violation, which the
-- import code catches and treats as "already imported" rather than an
-- error).
create unique index sites_external_source_id_idx
  on sites (external_source, external_id)
  where external_source is not null and external_id is not null;
