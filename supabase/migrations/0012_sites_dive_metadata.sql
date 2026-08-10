-- 0012_sites_dive_metadata.sql
-- Shore Dive — Task 21 (T21.21): the three schema pieces multi-catalogue
-- dive-site aggregation needs — depth, shore access, and multi-source
-- provenance.
--
-- Context. `sites` was designed around a single upstream source (0008's
-- `external_source`/`external_id`, written by the OpenStreetMap import) and
-- around what a *map pin* needs (0010's `site_type`). Aggregating several
-- catalogues at once — OpenStreetMap, Florida FWC's artificial-reef
-- program, and FWC's Unified Reef Map habitat polygons — breaks both
-- assumptions and adds a third gap:
--
--   1. Depth is the single strongest signal for whether a site is relevant
--      to our actual audience (Open Water / Advanced Open Water recreational
--      divers), and there is nowhere to put it.
--      See src/lib/sites/dive-suitability.ts.
--   2. Shore access is the entire premise of this app and no catalogue
--      records it — it has to be derived and then *stored*, along with the
--      evidence it was derived from.
--      See src/lib/sites/shore-access.ts.
--   3. After cross-source deduplication (src/lib/sites/dedupe.ts) one row in
--      `sites` legitimately derives from several upstream records at once —
--      an FWC artificial-reef entry merged with an OSM node is one site with
--      two sources. 0008's two columns can only ever describe one.
--
-- All three modules referenced above already exist and are tested; this
-- migration adds the persistence they were written against, and deliberately
-- preserves each one's "unknown" state rather than flattening it into a
-- default (see the NULL discussion under each section).
--
-- NOT YET APPLIED to any live project — same status as every other file in
-- this directory (see supabase/README.md "How to apply" and Open item #15).
-- Safe to apply any time after 0001_init.sql (the only migration that
-- creates `sites`). No dependency on 0008/0010 beyond all three being Task
-- 21 work, though numeric order is the natural one.

-- ---------------------------------------------------------------------
-- 1. Depth — sites.depth_min_ft / sites.depth_max_ft
-- ---------------------------------------------------------------------
-- **FEET, not metres.** Stated in the column names themselves, not just in
-- a comment, because this is the one unit mistake in this schema that would
-- be both silent and dangerous: a 30 m wreck read as 30 ft would present a
-- ~100 ft Advanced Open Water dive as an Open Water one. Feet is also what
-- the source data and the certification limits are both already expressed
-- in — src/lib/sites/dive-suitability.ts's OPEN_WATER_MAX_FT (60),
-- ADVANCED_OPEN_WATER_MAX_FT (100) and RECREATIONAL_MAX_FT (130) are the
-- widely-taught training depths, and parseDepthRangeFt() already converts
-- the metric strings some catalogues ship ("12m") into feet at the import
-- boundary. Anything writing these columns converts to feet first; nothing
-- downstream is allowed to guess the unit.
--
-- **Both nullable, and that is load-bearing rather than laziness.** Most
-- catalogue records genuinely carry no depth at all — OSM's `depth` tag is
-- absent on the overwhelming majority of scuba nodes, and FWC catalogues
-- deployment events, not dive profiles. classifyDiveSuitability() treats
-- unknown depth as an explicit "Depth not recorded — check a local source
-- before planning this dive", deliberately *not* as a certification level
-- and deliberately *not* as "too deep" (which would silently hide real
-- shore dives). A NOT NULL DEFAULT 0 — or any invented sentinel — would
-- destroy exactly that distinction and turn "we don't know" into a depth
-- claim a diver could act on. So: NULL means not recorded, and every read
-- path must keep saying so.
--
-- This is the opposite call from 0010's `site_type` (NOT NULL DEFAULT
-- 'unclassified') and the same call as 0001's `legal_access_status`
-- (nullable "not yet assessed"): `site_type` has a real in-band value for
-- "no known category", whereas a number column has no honest in-band value
-- for "no known depth".
--
-- **min is the *shallowest divable* depth, not a bounding box.** A wreck
-- whose deck sits at 60 ft and whose sand sits at 100 ft stores 60/100, and
-- dive-suitability classifies it on the 60 — judging solely on maximum
-- depth would wrongly exclude a legitimate dive. Storing a single depth
-- (a point record, or a catalogue that publishes one number) means writing
-- the same value to both columns, which is what parseDepthRangeFt() already
-- returns for that case.
--
-- numeric(5,1): up to 9999.9 ft with one decimal place, far past anything
-- divable, and numeric rather than integer because some sources publish
-- fractional/metric-converted depths. Same numeric-with-explicit-precision
-- convention as 0005_webcam_readings.sql's visibility_meters.
alter table sites add column depth_min_ft numeric(5, 1);
alter table sites add column depth_max_ft numeric(5, 1);

comment on column sites.depth_min_ft is
  'Shallowest divable depth **in feet** (a wreck''s deck, a reef''s top), '
  'or NULL for "not recorded" — never 0, which would be a depth claim. '
  'Feeds src/lib/sites/dive-suitability.ts''s certification-suitability '
  'call, which classifies a site on this value rather than on depth_max_ft.';

comment on column sites.depth_max_ft is
  'Maximum depth **in feet**, or NULL for "not recorded". Equal to '
  'depth_min_ft for sources that publish a single depth rather than a '
  'range.';

-- Ordering constraint. Written with explicit NULL handling rather than
-- relying on `depth_min_ft <= depth_max_ft` evaluating to NULL (and
-- therefore passing) when either side is absent — the three-valued-logic
-- behavior is correct either way, but a constraint on a safety-adjacent
-- column should read as what it means to a future maintainer rather than
-- depend on SQL trivia being remembered.
alter table sites add constraint sites_depth_min_le_max check (
  depth_min_ft is null or depth_max_ft is null or depth_min_ft <= depth_max_ft
);

-- Negative depth is never meaningful here (altitude is not a thing this
-- column models), and 0 is treated as a real recorded value rather than a
-- missing one — see depth_min_ft's comment: "not recorded" is NULL.
alter table sites add constraint sites_depth_nonnegative check (
  (depth_min_ft is null or depth_min_ft >= 0)
  and (depth_max_ft is null or depth_max_ft >= 0)
);

-- Supports the map's "sites within my certification level" filtering
-- (dive-suitability classifies on the shallowest depth, so that is the
-- column a range predicate would hit). Partial on `not null`, the same
-- technique 0008 and 0011 already use on this table: rows with no recorded
-- depth are the bulk of an imported catalogue and can never satisfy a depth
-- filter, so keeping them out keeps the index proportional to the rows that
-- actually carry the data.
create index sites_depth_min_ft_idx on sites (depth_min_ft) where depth_min_ft is not null;

-- ---------------------------------------------------------------------
-- 2. Shore access — shore_access_confidence enum + three columns
-- ---------------------------------------------------------------------
-- This app is specifically about *shore* diving, and no upstream catalogue
-- records that property, so src/lib/sites/shore-access.ts derives it by
-- measuring each site against a small hand-curated list of real, verified
-- entry points (SOUTH_FLORIDA_ENTRY_POINTS) and comparing against an
-- empirically-grounded threshold (SHORE_DIVE_MAX_MILES = 0.5 mi, the
-- Lauderdale-by-the-Sea second reef; SHORE_DIVE_EASY_MILES = 0.17 mi, the
-- first reef line — see that module's header for the three independent
-- lines of evidence behind those numbers).
--
-- Enum values match ShoreAccessConfidence in that module exactly, and the
-- enum is named after the TypeScript type rather than after the column
-- (`shore_access`). That departs from 0010's same-name type/column
-- convention on purpose and follows 0001's `provenance_state`/`provenance`
-- precedent instead: the column answers "is this shore-accessible", the
-- type is specifically a *confidence* scale, and naming it so keeps the DB
-- enum and the classifier that produces it obviously the same vocabulary.
--
-- No 'confirmed' value exists, and none should be added from derived data.
-- shore-access.ts is explicit that distance is the only input, and that
-- current, surf, visibility, boat traffic, entry footing and diver fitness
-- all dominate it in practice — none of which are in this data. Per
-- CLAUDE.md's standing rule against implying guarantees the system can't
-- back, the strongest thing this column may ever say is 'likely'.
create type shore_access_confidence as enum (
  'likely',    -- well inside the measured baseline (<= ~300 yd)
  'marginal',  -- near its outer edge — a real swim conditions could rule out
  'unlikely'   -- no known entry point in range
);

-- Nullable, and the NULL is a third real state, not an absence of care:
-- NULL means "not yet classified" (no classification pass has run against
-- this row), which is distinct from 'unlikely' ("classified, and no
-- catalogued entry is in range"). Same nullable "not yet assessed" pattern
-- as 0001's legal_access_status, and for the same reason — collapsing the
-- two would make a never-examined site indistinguishable from one that was
-- examined and found boat-only.
--
-- Worth stating plainly, because it constrains how this may be rendered:
-- 'unlikely' is ALSO the honest answer for a site that is genuinely
-- shore-diveable from an entry nobody has catalogued yet. Absence of a
-- known entry is not evidence the dive is boat-only (shore-access.ts's own
-- wording), so no UI may render this column as "boat access only".
alter table sites add column shore_access shore_access_confidence;

comment on column sites.shore_access is
  'Derived shore-access confidence (src/lib/sites/shore-access.ts). NULL '
  'means not yet classified — distinct from ''unlikely'', which means '
  'classified with no catalogued entry point in range. Never render '
  '''unlikely'' as "boat access only": it is also the honest answer for a '
  'site reachable from an entry nobody has catalogued yet. Never render '
  '''likely'' as a confirmation the dive is safe — distance is the only '
  'input to this classification.';

-- The evidence behind the classification, stored alongside it rather than
-- recomputed. Two independent reasons this pair earns its columns:
--
--   1. It is what lets the UI say "295 yd from the 5th Street beach entry"
--      instead of an unexplained badge. A confidence value with no visible
--      basis is exactly the kind of bare, un-sourced signal plan.md's
--      Map-Driven Exploration pillar rules out for map pins ("never render
--      a bare color pin with no lineage"); the same standard applies to a
--      derived safety-adjacent tag.
--   2. It makes a future re-classification auditable. Both inputs to this
--      derivation are expected to change — the entry-point list grows (that
--      is explicitly how coverage grows, per shore-access.ts, as opposed to
--      loosening the threshold), and the thresholds themselves have already
--      been corrected once, from a wrong 0.25 mi to the current 0.5 mi.
--      Storing which entry a row was measured from and how far makes "which
--      rows would change under the new list/threshold, and why" answerable
--      from the data instead of by re-running the whole classifier and
--      diffing.
--
-- shore_entry_id is a plain text slug (ShoreEntryPoint.id, e.g.
-- 'south-beach-5th-st'), NOT a foreign key: the entry points are a
-- hand-curated constant in application code, not a table, and inventing a
-- table for them here would be speculative schema for a list of eight
-- rows that no feature reads from the database yet. The tradeoff is
-- accepted and named: nothing at the DB level stops this from holding a
-- slug that no longer exists in SOUTH_FLORIDA_ENTRY_POINTS, so a reader
-- that can't resolve the slug must degrade to showing the distance alone,
-- never to inventing an entry name.
alter table sites add column shore_entry_id text;

-- **YARDS.** Same explicit-unit-in-the-name discipline as the depth columns
-- above, and the conversion is the writer's job: classifyShoreAccess()
-- returns `distanceMiles`, so an importer writing this column multiplies by
-- 1760 first. Yards rather than miles because this is a number shown
-- directly to a diver deciding whether to make the swim, and "295 yd" is
-- the unit that decision is actually made in — the fractional miles the
-- classifier works in ("0.168 mi") would have to be converted at every
-- render site instead of once at the write.
--
-- Populated even when shore_access is 'unlikely' (the classifier still
-- reports the nearest entry and its distance when one exists) — that is
-- precisely the case where "why was this ruled out" is worth being able to
-- answer. NULL when no entry point exists at all, or when the row has not
-- been classified.
--
-- numeric(7,1) rather than a tight range check: this column records a
-- measured distance, including ones far past SHORE_DIVE_MAX_MILES (~880
-- yd), so constraining it to the threshold would reject exactly the
-- measurements that justify an 'unlikely'. Only the nonsensical case
-- (negative) is rejected.
alter table sites add column shore_distance_yards numeric(7, 1)
  check (shore_distance_yards is null or shore_distance_yards >= 0);

comment on column sites.shore_entry_id is
  'ShoreEntryPoint.id the shore_access classification was measured from '
  '(src/lib/sites/shore-access.ts''s SOUTH_FLORIDA_ENTRY_POINTS). Text '
  'slug, deliberately not an FK — the entry points are a curated constant '
  'in application code, not a table. A reader that cannot resolve the slug '
  'must fall back to showing the distance alone, never to inventing a name.';

comment on column sites.shore_distance_yards is
  'Distance **in yards** from shore_entry_id to this site, as measured by '
  'classifyShoreAccess() (which returns miles — convert at the write, '
  'x1760). Stored so the UI can say "295 yd from the 5th Street beach '
  'entry" rather than showing an unexplained badge, and so a future '
  're-classification against a grown entry-point list or a corrected '
  'threshold is auditable. Populated for ''unlikely'' rows too, when a '
  'nearest entry exists.';

-- Supports the "shore-diveable sites only" map filter, which is this app's
-- single most likely non-geographic query predicate. Partial for the same
-- reason as the depth index: unclassified rows can never satisfy the
-- filter.
create index sites_shore_access_idx on sites (shore_access) where shore_access is not null;

-- ---------------------------------------------------------------------
-- 3. Multi-source provenance — the site_sources table
-- ---------------------------------------------------------------------
-- 0008 gave `sites` a single (external_source, external_id) pair, which was
-- correct for a single-catalogue import and is structurally unable to
-- describe the post-deduplication reality. src/lib/sites/dedupe.ts clusters
-- records *across* catalogues — its whole premise is that the same physical
-- wreck or reef arrives more than once, under different names, from
-- different sources, with coordinates that disagree — and the output of a
-- cluster is one `sites` row derived from N upstream records. An FWC
-- artificial-reef record merged with an OSM node is one site with two real,
-- separately-traceable sources.
--
-- A join table rather than an array column on `sites`, because each link
-- carries its own attributes (the upstream id, when it was last fetched)
-- and because uniqueness has to be enforceable — see the unique index
-- below, which is the part that actually makes duplicate imports
-- impossible.
--
-- This is also an attribution surface, not just bookkeeping. The OSM path
-- carries a real ODbL attribution obligation (see supabase/README.md's
-- "External dive-site sourcing" section), which 0008 satisfies today by
-- baking a sentence into `sites.description` at import time. Once a site
-- can derive from several sources, "which catalogues does this row come
-- from" is a question the UI must be able to answer from data rather than
-- from generated prose — hence public read (see RLS below).
create table site_sources (
  id uuid primary key default gen_random_uuid(),
  -- `on delete cascade`, matching 0005_webcam_readings.sql's camera_source_id
  -- rather than the `on delete set null` this schema uses for user
  -- attribution: a source link with no site to attribute to is meaningless,
  -- not an orphaned record worth keeping de-attributed the way a
  -- community-authored hazard report is.
  site_id uuid not null references sites (id) on delete cascade,
  -- Deliberately the SAME column names and the same short-slug vocabulary as
  -- sites.external_source/external_id (0008) and
  -- external_search_area_cache.external_source (0009) — 'osm' today, with
  -- 'fwc_artificial_reef' and 'fwc_urm' as the aggregation sources this
  -- migration is being written for. Identical naming is not cosmetic: it
  -- makes the eventual backfill out of 0008's columns a literal column copy
  -- (see the redundancy note below) rather than a mapping exercise, and it
  -- keeps one vocabulary for source slugs across three tables.
  external_source text not null,
  external_id text not null,
  -- When the upstream record was last fetched/confirmed from its source.
  -- This is a freshness signal about the *upstream data*, not row-creation
  -- bookkeeping — a re-fetch that finds the record unchanged still moves it
  -- forward. Deliberately the only timestamp here: on the only write path
  -- that exists (an importer), creation and fetch are the same event, and a
  -- second created_at column that always equalled it at insert would add a
  -- field with no distinct meaning. Contrast 0005's captured_at/created_at
  -- pair, where the two genuinely differ and are used by different callers.
  fetched_at timestamptz not null default now()
);

comment on table site_sources is
  'One row per (site, upstream catalogue, upstream id) — the multi-source '
  'replacement for sites.external_source/external_id (0008), which can only '
  'describe one source. After cross-source deduplication '
  '(src/lib/sites/dedupe.ts) a single site legitimately derives from '
  'several catalogues at once (e.g. an FWC artificial-reef record merged '
  'with an OSM node). Also the data behind source attribution in the UI — '
  'see the ODbL note in supabase/README.md.';

comment on column site_sources.external_source is
  'Short slug for the upstream catalogue — same vocabulary as '
  'sites.external_source (0008) and external_search_area_cache.'
  'external_source (0009): ''osm'', ''fwc_artificial_reef'', ''fwc_urm''.';

comment on column site_sources.external_id is
  'The upstream catalogue''s own stable identifier for this record (an OSM '
  'node id, an FWC reef record id), as text. NOT NULL — a link row with no '
  'upstream id traces nothing.';

comment on column site_sources.fetched_at is
  'When this upstream record was last fetched/confirmed from its source — '
  'a freshness signal about the upstream data, advanced by a re-fetch even '
  'when nothing changed. Not row-creation bookkeeping.';

-- The constraint that actually prevents duplicate imports, and the reason a
-- join table beats an array column. Scoped to (external_source,
-- external_id) and NOT to (site_id, external_source, external_id): one
-- upstream record describes exactly one physical site, so the same OSM node
-- must never be attached to two different `sites` rows. Including site_id in
-- the key would permit precisely the failure deduplication exists to
-- prevent — the same node linked to both halves of a pair that should have
-- been merged, with nothing at the DB level objecting.
--
-- Both columns are NOT NULL, so unlike 0008's partial index this needs no
-- WHERE clause; it is a plain unique index that always applies. That is also
-- why it is usable as a straightforward ON CONFLICT target, which 0008's
-- partial index is not (see that migration's implementation note and
-- osm-import.ts's pre-check-then-insert workaround) — an aggregation
-- importer writing here can use a plain upsert.
create unique index site_sources_external_idx on site_sources (external_source, external_id);

-- "Which catalogues does this site come from" — the attribution read, one
-- lookup per site-detail page render.
create index site_sources_site_id_idx on site_sources (site_id);

-- ---------------------------------------------------------------------
-- Redundancy with 0008's sites.external_source/external_id — decided,
-- documented, and deliberately NOT resolved in this migration
-- ---------------------------------------------------------------------
-- Those two columns are now redundant in principle: site_sources can express
-- everything they can, plus the cases they cannot. They are nonetheless kept
-- for now, on purpose, because dropping them here would break working code
-- this migration does not own:
--
--   - src/lib/sites/osm-import.ts writes both columns on every imported row.
--   - Its duplicate-prevention pre-check queries `sites` by external_id
--     directly, and 0008's partial unique index
--     (sites_external_source_id_idx) is what makes that correct under a
--     race.
--
-- So the intended relationship, while both exist:
--
--   * site_sources is authoritative for the full set of sources a site
--     derives from.
--   * sites.external_source/external_id continue to mean specifically "the
--     source this row was originally created from", and must stay
--     consistent with the corresponding site_sources row for that source.
--     They are a denormalization of one row of site_sources, not an
--     independent claim.
--
-- Two sources of truth is a real cost, so it is time-boxed rather than left
-- open-ended. The intended end state is that 0008's columns are backfilled
-- into site_sources and dropped, in a later migration, in this order:
--
--   1. insert into site_sources (site_id, external_source, external_id, fetched_at)
--        select id, external_source, external_id, updated_at
--        from sites
--        where external_source is not null and external_id is not null
--        on conflict (external_source, external_id) do nothing;
--      (updated_at is the closest honest stand-in for "when this was last
--      fetched" for rows imported before this table existed — it is an
--      approximation, and worth a comment on the backfill rather than a
--      silent now().)
--   2. Repoint osm-import.ts's pre-check at site_sources.
--   3. Drop sites_external_source_id_idx, then the two columns.
--
-- Step 2 is application code owned elsewhere, which is exactly why this
-- migration does not attempt steps 1 and 3: a schema change that breaks a
-- live import pipeline in the same batch would violate this project's
-- one-small-reviewable-change-per-migration standard (CLAUDE.md's batch
-- discipline). Tracked as supabase/README.md Open item #16 so the interim
-- duplication is a scheduled cleanup rather than a silently permanent
-- second source of truth.

-- ---------------------------------------------------------------------
-- Row-Level Security — public read, service-role-only write
-- ---------------------------------------------------------------------
-- Precedent followed: 0005_webcam_readings.sql, verbatim in shape
-- (`enable row level security`, an explicit grant of `select` only to
-- anon/authenticated, one unconditional select policy, and no
-- insert/update/delete policy at all).
--
-- Explicitly NOT 0009_external_search_area_cache.sql's stricter
-- no-policy-at-all posture, even though both tables are written only by
-- automated pipelines. The distinction is what the table describes, per the
-- brief's "follow the same posture as the data it describes":
-- external_search_area_cache is internal rate-limit bookkeeping no diver
-- would ever look at, whereas site_sources describes `sites` — which is
-- public-read (`sites_select_public`, 0002_rls.sql, `using (true)`) — and
-- carries the source attribution the UI has to be able to render, including
-- for the ODbL obligation noted above. Attribution that anon users cannot
-- read cannot be displayed to them.
--
-- No insert/update/delete for anon/authenticated: rows here are written
-- exclusively by the aggregation/import pipelines through the service-role
-- client (src/lib/supabase/admin.ts), which bypasses RLS entirely — the
-- same documented "no moderator/worker role modeled yet, service-role
-- required" gap that 0002 (VERIFIED promotion), 0003 (approve/reject),
-- 0004 (bundle upload) and 0005 (reading inserts) all already carry.
-- Table-level grants omit insert/update/delete for the same reason 0003 and
-- 0005 omit them: with no policy, granting them would do nothing.
--
-- Note that this table is *not* covered by 0006/0011's per-user submission
-- rate-limit trigger, and correctly so: that trigger reads a submitter off
-- the row and no-ops when it is NULL, and site_sources has no user
-- attribution column at all — there is no self-service write path here to
-- throttle.
alter table site_sources enable row level security;

grant usage on schema public to anon, authenticated;
grant select on site_sources to anon, authenticated;

create policy site_sources_select_all
  on site_sources for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy for anon/authenticated — see the RLS
-- comment block above. Every write goes through the service-role key.

-- ---------------------------------------------------------------------
-- No RLS change for the new `sites` columns — and one thing that implies
-- ---------------------------------------------------------------------
-- Adding columns to `sites` inherits its existing policies unchanged, so
-- nothing here needs a new one. Worth naming the consequence rather than
-- leaving it to be discovered: `sites_insert_own` (0002_rls.sql) lets a
-- signed-in user insert a `sites` row (capped at provenance = 'COMMUNITY'),
-- and that now includes self-declaring depth_min_ft/depth_max_ft and
-- shore_access — columns that are supposed to be *derived* by
-- dive-suitability/shore-access, and that feed a diver's go/no-go read.
-- That is not a new hole (name and description were already self-declarable
-- and are equally load-bearing) and it is contained by the same COMMUNITY
-- provenance cap, but it does mean a derived-looking value on a COMMUNITY
-- row is not necessarily derived. Flagged as supabase/README.md Open item
-- #17 rather than fixed here — the honest fix is a moderation/derivation
-- distinction this schema has no role model for yet, not a column-level
-- policy bolted on in this migration.
