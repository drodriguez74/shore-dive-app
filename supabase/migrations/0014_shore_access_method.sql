-- 0014_shore_access_method.sql
-- Shore Dive — global shore-access classification, part A4.
--
-- Context. `0012_sites_dive_metadata.sql` added `shore_access` (a
-- confidence tier) and `shore_entry_id`/`shore_distance_yards` (the
-- evidence a curated entry produced it from) — but it only ever modeled
-- one production process: a hand-researched, individually cited
-- `ShoreEntryPoint` from `src/lib/sites/shore-access.ts`'s
-- `SOUTH_FLORIDA_ENTRY_POINTS` (now `CURATED_ENTRY_POINTS`). Founder
-- (2026-08-10): "I may dive outside of Florida... I have no idea what
-- scuba diver will use my app and where they are located" — the app needs
-- to say something useful about a site anywhere on Earth, not just
-- Florida's hand-curated coastline.
--
-- `classifyShoreAccess()` gained a second, weaker signal for exactly this:
-- OpenStreetMap's own `scuba_diving:entry=shore` tag, a real, per-site,
-- global, community-tagged claim — already parsed by `osm-import.ts`'s
-- `deriveEntryType()` and, until now, discarded rather than used. A site
-- classified from this tag deserves a real answer instead of a permanent
-- `unlikely`, but it must never be presented with the same trust as a
-- curated entry — nobody has verified it the way every `ShoreEntryPoint`
-- in this codebase has been.
--
-- `shore_access` (the confidence) and `shore_access_method` (which signal
-- produced it) are deliberately two columns, not one combined value.
-- `shore_access_confidence`'s own comment (0012) says plainly "the column
-- answers 'is this shore-accessible', the type is specifically a
-- *confidence* scale" — folding provenance into it (e.g. an
-- `'osm_tag_marginal'` value) would break that single-axis meaning and
-- force every reader to pattern-match a combined string instead of two
-- independent facts. Same reasoning `0001_init.sql`'s `provenance_state`
-- and `site_type` stay separate columns rather than a merged enum.

create type shore_access_method as enum (
  'curated_entry',  -- distance to a hand-researched ShoreEntryPoint with a real citation
  'osm_tag'         -- an unverified OpenStreetMap scuba_diving:entry=shore tag on this exact site
);

alter table sites add column shore_access_method shore_access_method;

comment on column sites.shore_access_method is
  'Which signal produced shore_access/shore_entry_id/shore_distance_yards '
  '(src/lib/sites/shore-access.ts). ''curated_entry'' = distance to a '
  'hand-researched entry point with a real citation (the trusted, original '
  'model). ''osm_tag'' = an unverified OpenStreetMap scuba_diving:entry=shore '
  'community tag on this specific site node, used only when no curated '
  'entry was in range. NULL whenever shore_access is NULL (not yet '
  'classified) — this is a third real state, not an absence of care, same '
  'as shore_access''s own NULL/''unlikely'' distinction. UI must render '
  'these visibly differently, never as equally trustworthy: an osm_tag row '
  'is capped at ''marginal'' confidence by the classifier itself and must '
  'never be presented the way a researched, cited curated_entry is.';

-- Backfill: every existing populated shore_access row was produced by the
-- curated-entry model this session (osm_tag classification is new and has
-- never run against live data before this migration) — unambiguous, no
-- judgment call. Rows still NULL stay NULL; see the follow-on backfill
-- script (T[A7]) for populating those, which is a live-data write and
-- deliberately not part of a schema migration.
update sites set shore_access_method = 'curated_entry' where shore_access is not null;

-- Supports "explain how this badge was produced" reads and a future
-- "curated entries only" filter (an osm_tag row is real but unverified —
-- a diver comparing two candidate sites may reasonably want to see only
-- the researched ones). Partial, same pattern as sites_shore_access_idx
-- in 0012: rows with no method can never satisfy a method filter.
create index sites_shore_access_method_idx on sites (shore_access_method)
  where shore_access_method is not null;

-- No RLS change — same reasoning as every dive-metadata column 0012 added:
-- a plain column on `sites`, which already has public select and a
-- COMMUNITY-capped self-service insert/update. That self-service path
-- technically permits self-declaring shore_access_method same as every
-- other derived-looking column already listed under 0012's Open item #17
-- in supabase/README.md — not a new hole, not fixed here.
