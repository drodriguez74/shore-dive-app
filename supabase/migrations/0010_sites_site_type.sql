-- 0010_sites_site_type.sql
-- Shore Dive — Task 21 (T21.5, data-layer half only): site-type
-- classification for map icons.
--
-- plan.md v5 Resolved Decision #7 ("Site-type classification for map
-- icons") adds a `site_type` axis to `sites` — shore reef, shipwreck,
-- cave, freshwater spring, artificial reef — so the map can eventually
-- render a distinct icon per kind of site, not just provenance/hazard/
-- legal-access as it does today. This migration is the schema half only.
-- The map-icon *rendering* half of T21.5, and the still-open pin
-- legibility design pass Decision #7 explicitly requires
-- (creative/AESTHETIC_REVIEW.md, flagged in both plan.md and TASKS.md's
-- T21.5 entry — the pin already carries 3 visual dimensions and risks
-- becoming unreadable with a careless 4th), are separate, in-flight work,
-- not landed by this file.
--
-- TASKS.md's "Hold lifted for T21.5/T21.6/T21.7" note (2026-08-08)
-- records the founder's explicit go-ahead for this data-layer work as
-- part of the T21.5/T21.6/T21.7 map-coding batch; the map's actual icon
-- *artwork* still leans conservative/placeholder pending the design pass
-- referenced above — only the schema + OSM tag derivation are in scope
-- here.
--
-- NOT YET APPLIED to any live project — same status as every other file
-- in this directory (see supabase/README.md "How to apply"). Safe to
-- apply any time after 0001_init.sql (the only migration that creates
-- `sites`).

-- ---------------------------------------------------------------------
-- site_type enum
-- ---------------------------------------------------------------------
-- Same same-name type/column convention 0001_init.sql already uses for
-- `legal_access_status` (rather than `provenance_state`/`provenance`'s
-- different-name convention) — no reason to invent a second name here.
-- Six values, matching plan.md Resolved Decision #7 exactly. The OSM tag
-- mapping in the comments below reflects live Overpass queries run
-- against overpass-api.de's own mirror during this pass (see
-- src/lib/sites/osm-import.ts's deriveSiteType for the derivation logic
-- and fuller research notes):
--   shore_reef        -- OSM natural=reef
--   shipwreck          -- OSM historic=wreck (confirmed live in Florida:
--                          USS Vandenberg, USS Spiegel Grove, several
--                          named/unnamed FL Keys wrecks)
--   cave                -- OSM natural=cave_entrance (confirmed live:
--                          Devil's Den, FL — notably tagged
--                          cave_entrance, not spring, despite being a
--                          "prehistoric spring" colloquially)
--   spring              -- OSM natural=spring, Florida-specific
--                          (confirmed live: Ginnie Spring, Ichetucknee
--                          Spring, Rainbow Spring / Rainbow Spring North,
--                          all also carrying sport=scuba_diving)
--   artificial_reef     -- no OSM tag reliably co-occurs with
--                          sport=scuba_diving today. man_made=reef is a
--                          real, actively-used OSM tag elsewhere (e.g.
--                          Windara Shellfish Restoration Reef, Australia;
--                          Virginia Dept. of Wildlife Resources'
--                          Christmas Tree/Tire Reefs), but a global
--                          Overpass query found zero nodes where it
--                          co-occurs with sport=scuba_diving — so this
--                          value is reachable only via manual/founder
--                          curation for now, never derived by the import
--                          pipeline.
--   unclassified        -- the honest default: the 3 founder-seeded
--                          rows, any future manually-added site with no
--                          clear category, and any OSM import whose tags
--                          don't match one of the conventions above.
--                          Never guessed.
create type site_type as enum (
  'shore_reef',
  'shipwreck',
  'cave',
  'spring',
  'artificial_reef',
  'unclassified'
);

-- ---------------------------------------------------------------------
-- sites.site_type
-- ---------------------------------------------------------------------
-- NOT NULL DEFAULT 'unclassified', deliberately not nullable — unlike
-- legal_access_status (where NULL means a distinct "not yet assessed"
-- state separate from an explicit 'open'), 'unclassified' already *is*
-- the "no known category" state for this column, so a NULL-vs-
-- 'unclassified' distinction would be redundant. This instead follows
-- provenance_state's not-null-with-default convention.
alter table sites add column site_type site_type not null default 'unclassified';

comment on column sites.site_type is
  'What kind of site this is, for map-icon rendering (plan.md Resolved '
  'Decision #7). Defaults to ''unclassified'' — never guessed for a row '
  'whose source data does not actually support a category (the 3 '
  'founder-seeded rows, manually-added sites with no clear type, and any '
  'OSM import whose tags do not match one of the known conventions in '
  'src/lib/sites/osm-import.ts''s deriveSiteType).';

-- Supports future map-rendering/filtering by type (T21.5's rendering
-- half, T21.7's symbol-layer migration) without a sequential scan, same
-- reasoning as sites_provenance_idx below it.
create index sites_site_type_idx on sites (site_type);
