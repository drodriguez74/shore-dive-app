-- 0013_sites_research_summary.sql
-- Shore Dive — Task 22 (T22.1): researched site-description enrichment.
--
-- Context. Every `sites` row's `description` is exactly what its upstream
-- catalogue provided at import time (FWC's generic artificial-reef
-- boilerplate for ~90% of rows, OSM's free-text `description` tag for the
-- rest) — nobody has ever added anything to it. Founder, after watching a
-- string of real shore-access bugs get found and fixed this session purely
-- by web-searching individual sites by name ("I'm now really doubting the
-- integrity of the dive site information... we really need to dig deep and
-- research using google search in ai mode"): the same research process that
-- found those bugs should also produce a real, readable summary for the
-- site detail page, not just a corrected `shore_access` value.
--
-- Scope (v1, per the founder-approved scoping conversation): the ~35
-- currently shore-accessible (`likely`/`marginal`) sites, not all 445 — see
-- `TASKS.md` T22 for the full rationale (this session's own deep-research
-- sweep already showed most of the other ~410 generic FWC records return
-- zero independent web coverage; researching them would be a lot of effort
-- for "nothing found" on nearly all of them).
--
-- Three new nullable columns, deliberately NOT a rename/overwrite of
-- `description`:
--
--   1. It preserves `description` as the honest, distinct record of what
--      the *upstream catalogue* said (including its own required ODbL
--      attribution sentence for OSM-sourced rows — see 0008's note) versus
--      what *this app's own research* found. Blending the two into one
--      field would make it impossible to tell which claim came from where,
--      exactly the "un-sourced signal" plan.md's Map-Driven Exploration
--      pillar already rules out for pins ("never render a bare color pin
--      with no lineage") — the same standard applies to site prose.
--   2. It matches this migration's own `shore_entry_id`/`shore_distance_yards`
--      precedent (0012): store the evidence alongside the conclusion, not
--      just the conclusion, so a future re-research pass is auditable
--      against what the last one actually found rather than starting blind.
-- ---------------------------------------------------------------------
-- 1. sites.research_summary — the synthesized text itself
-- ---------------------------------------------------------------------
-- Plain text, not the upstream catalogue's own words. Two reasons this
-- matters enough to state as a constraint on how this column may ever be
-- populated, not just a style preference:
--
--   - Copyright/attribution: a summary is this app's own original synthesis
--     of what multiple independent sources say, cited via
--     `research_sources` below — never a copy-pasted paragraph from a dive
--     shop's website.
--   - Correctness: every other derived, safety-adjacent field in this
--     schema (`shore_access`, `depth_min_ft`) is explicit that it does NOT
--     claim certainty the underlying process can't back (see 0012's
--     column comments). This one is no different — it is a summary of what
--     research turned up, not a verified fact sheet, and rendering code
--     must carry the same "AI-assisted web research, not independently
--     verified" disclosure `site-research-summary.tsx` implements, the same
--     way `shore_access` rendering must never say "confirmed".
alter table sites add column research_summary text;

comment on column sites.research_summary is
  'Original-synthesis summary from web research (Task 22), distinct from '
  'the upstream catalogue''s own `description` — never copy-pasted source '
  'text. NULL means no research pass has covered this site yet, which is '
  'the overwhelming majority of rows by design (v1 scope is the ~35 '
  'shore-accessible sites, not all 445 — see TASKS.md T22). Must always '
  'render with an explicit "not independently verified" disclosure, same '
  'standing rule as `shore_access`.';

-- ---------------------------------------------------------------------
-- 2. sites.research_sources — the citations behind the summary
-- ---------------------------------------------------------------------
-- jsonb array of `{title, url}`, not a normalized join table. Deliberately
-- the lighter-weight choice here, unlike `site_sources` (0012) for
-- catalogue provenance — the two look similar but answer different
-- questions and carry different weight:
--
--   - `site_sources` is queried on its own (attribution rendering,
--     duplicate-import prevention via a unique index) and grows
--     independently of any single site's research history.
--   - `research_sources` is never queried independently of the summary it
--     backs — it is always read and rendered as a unit alongside
--     `research_summary`, on the one page (site detail) that shows either.
--     A join table would buy referential integrity this data doesn't need
--     (a source URL going stale doesn't invalidate anything downstream the
--     way a duplicate `site_sources` row would) at the cost of a join for
--     every site-detail render.
--
-- NULL (not `'[]'`) means the same "no research pass yet" state as a NULL
-- `research_summary` — the two are written together, by the same import
-- script, and read together by the same rendering code. No constraint
-- enforces they're both-null-or-both-set (this table has no trigger
-- infrastructure for cross-column invariants, and adding one for a single
-- write path used by one internal script would be speculative), but every
-- writer in `scripts/` must set both or neither.
alter table sites add column research_sources jsonb;

comment on column sites.research_sources is
  'jsonb array of `{title, url}` citations backing `research_summary` '
  '(Task 22) — e.g. [{"title": "Force-E Scuba Centers", "url": "https://..."}]. '
  'Written and read as a unit alongside `research_summary`; NULL means the '
  'same "not yet researched" state. Deliberately a jsonb column, not a '
  'join table — unlike `site_sources` (0012), this is never queried '
  'independently of the one summary it backs.';

-- ---------------------------------------------------------------------
-- 3. sites.research_summary_updated_at — freshness, not row bookkeeping
-- ---------------------------------------------------------------------
-- Same "freshness signal about the derived data, not about the row" pattern
-- as `site_sources.fetched_at` (0012) and this codebase's general standing
-- rule against ever showing a bare/binary "researched" badge (plan.md's
-- Intent-Driven Offline Cache pillar: "show freshness... not just a binary
-- cached badge" — the same discipline applies here). A diver reading "per
-- research as of Aug 2026" can judge staleness themselves; a diver reading
-- an unstamped paragraph cannot.
--
-- Distinct from `sites.updated_at` (0001's generic trigger-maintained
-- timestamp, bumped by ANY column changing) because a shore_access
-- reclassification or a name typo fix must not silently make three-year-old
-- research prose look freshly researched.
alter table sites add column research_summary_updated_at timestamptz;

comment on column sites.research_summary_updated_at is
  'When `research_summary`/`research_sources` were last written by a '
  'research pass (Task 22) — a freshness signal distinct from the generic '
  '`updated_at` trigger, which bumps on ANY column change (a shore_access '
  'fix must not make old research prose look freshly written). NULL means '
  'not yet researched. Render as "per research as of [date]", the same '
  '"never a bare/binary freshness claim" rule as offline-cache staleness.';

-- No new index. Neither column is ever filtered/sorted on — the detail page
-- reads them by `id` (already indexed as the primary key), and no list view
-- needs "sites with a research summary" as a predicate today. Add one if
-- that changes, same "earn your index" discipline `0012` already documents
-- for `depth_min_ft`/`shore_access`.

-- No RLS change. Same reasoning as 0012's equivalent note: these are plain
-- columns on `sites`, which already has public `select` and a COMMUNITY-
-- capped self-service `insert`/`update` (0002_rls.sql). That self-service
-- path technically permits a signed-in user to write their own
-- `research_summary` text on a COMMUNITY row — not a new hole (`description`
-- was already equally self-declarable, see 0012's Open item #17) and no
-- worse than that existing gap, but worth naming here too: no UI may treat
-- a non-null `research_summary` as proof a real research pass produced it.
-- The one write path this migration is actually written for is the
-- service-role script described in TASKS.md T22 (`scripts/` — dry-run then
-- write, same discipline every other live-data change this session used),
-- which bypasses RLS entirely, same as every other derived-data writer in
-- this schema.
