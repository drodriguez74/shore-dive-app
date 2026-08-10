-- 0011_sites_rate_limit.sql
-- Shore Dive — attach 0006's rate-limit trigger to the fourth and last
-- self-service-insertable table: `sites`.
--
-- 0006_rate_limiting.sql built `public.enforce_submission_rate_limit()` and
-- attached it to `hazard_reports`, `lds_status`, and `camera_sources`. It
-- explicitly scoped `sites` OUT, with a reason that was accurate when
-- written:
--
--     "sites: not named in 0002_rls.sql's TODO, and has no live self-service
--      submission UI yet (unlike lds_status, see
--      src/components/lds/lds-submission-form.tsx, T16.3) to protect today."
--
-- That reason has aged out. `sites` is no longer the quiet table it was:
--   - `0002_rls.sql`'s `sites_insert_own` policy already grants every
--     authenticated user `insert` on `sites` (capped at
--     `provenance = 'COMMUNITY'` via WITH CHECK, but uncapped in *volume*).
--     "No UI exists yet" was never an access-control argument — the Supabase
--     client SDK is callable directly from any signed-in browser session, and
--     this app's write architecture has no server route standing between a
--     client and the database for these tables (0006's own "Why a DB trigger
--     over an application-layer check" section makes exactly this point).
--   - `sites` is now the one table in this schema deliberately designed to
--     grow continuously and unattended (Task 21's on-demand OpenStreetMap
--     import — `src/lib/sites/osm-import.ts`, T21.2, and T21.11's real South
--     Florida backfill). It is also the table every map pin reads from, so
--     flooding it degrades the core product surface, not just a moderation
--     queue.
--
-- This migration adds no new logic. 0006's function is reusable per-table via
-- trigger arguments (`user_column`, `window_minutes`, `max_rows`), so
-- covering a fourth table is one `create trigger` call, exactly as 0006's
-- header predicted when it made the same judgment call for `camera_sources`.
--
-- ---------------------------------------------------------------------
-- What this trigger covers, what it deliberately does NOT, and why that
-- split is correct rather than an oversight
-- ---------------------------------------------------------------------
-- This is the part worth reading carefully, because `sites` (unlike the
-- other three tables) has TWO live write paths with very different
-- identities, and this trigger intentionally only governs one of them.
--
-- COVERED — the self-service path (`sites_insert_own`, 0002_rls.sql):
--   A signed-in user inserting through the anon-key client. RLS's
--   `with check (created_by = auth.uid() and provenance = 'COMMUNITY')`
--   guarantees `NEW.created_by` is a real, non-null user id equal to
--   `auth.uid()` on this path — so the trigger counts and caps it, same as
--   `hazard_reports`/`lds_status`/`camera_sources`.
--
-- NOT COVERED — the automated import path (`upsertSitesFromOsm`,
-- `src/lib/sites/osm-import.ts`):
--   That pipeline writes through the Supabase **service-role** client
--   precisely to bypass RLS, and its row builder (`toInsertableRow`) never
--   populates `created_by` at all — imported rows are attributed to
--   OpenStreetMap via `external_source`/`external_id` (0008), not to a user.
--   So `NEW.created_by` is NULL for every imported row.
--
-- Which of those two outcomes that produces is worth stating precisely,
-- because the failure modes are not symmetric. Read
-- `enforce_submission_rate_limit()`'s actual body (0006, lines 96-149): it
-- does **not** call `auth.uid()`. It reads the submitter off the row being
-- inserted — `submitter := (to_jsonb(NEW) ->> user_column)::uuid` — and
-- immediately short-circuits:
--
--     if submitter is null then
--       ... return new;   -- fail open
--     end if;
--
-- So a NULL attribution column means the function returns NEW **unchanged
-- and without error**. It does not raise, it does not attempt a count
-- against a NULL uuid, and it cannot break the import. The outcome is "this
-- trigger is a no-op for service-role writes," not "this trigger rejects
-- service-role writes." That is the behavior this migration wants, and it is
-- being relied on deliberately here rather than discovered later.
--
-- (`auth.uid()` is still the value being enforced against on the covered
-- path — RLS is what ties `created_by` to it. The trigger reading the column
-- instead of calling `auth.uid()` directly is what makes it reusable across
-- four tables with four different attribution column names, and is also
-- exactly what makes the service-role case degrade quietly instead of
-- erroring.)
--
-- The automated path not being covered here is correct, not a hole, because
-- it is **already separately bounded** — by two independent limits added in
-- T21.13, both upstream of the insert:
--   1. A signed-in user is now required to trigger an external search at all
--      (`src/app/api/sites/search-nearby/route.ts` calls `auth.getUser()` on
--      the thin-area path and fails closed to "anonymous" if the check
--      itself throws) — so anonymous callers can no longer reach the
--      service-role write path at all.
--   2. `DAILY_EXTERNAL_SEARCH_CAP = 100`, a global rolling-24h ceiling
--      across all users and all grid cells
--      (`src/lib/sites/external-search-cache.ts`), on top of the per-cell
--      ~30-day cooldown from 0009.
-- A per-user row-count trigger would add nothing to either of those (there
-- is no per-user attribution on an imported row to count against in the
-- first place), while a version of this trigger that *did* try to block
-- NULL-attribution inserts would break a working, already-bounded pipeline.
-- Hence: covered path = human submissions, uncovered path = machine imports,
-- each bounded by the control that actually fits it.
--
-- ---------------------------------------------------------------------
-- Cap / window: 5 inserts per 10 minutes, same as the other three tables
-- ---------------------------------------------------------------------
-- Deliberately identical to 0006's numbers rather than a new judgment call.
-- 0006 documents the full reasoning (10-minute window taken verbatim from
-- 0002_rls.sql's own sketch; 5 rows generous enough for a real burst of
-- honest activity while bounding a scripted client to a low double-digit
-- hourly rate) and states it applied them uniformly "rather than guessing a
-- different number per table with nothing to justify the difference." That
-- is still true: there is no real `sites`-submission traffic to tune
-- against, since there is still no self-service site-submission UI. Adding a
-- fourth, differently-tuned number here would be inventing a distinction the
-- data doesn't support. Cap/window remain per-table trigger arguments, so
-- splitting `sites` apart later is a one-line change.
--
-- **Flagged for founder review**, same as 0006's: revisit if/when a real
-- "add a dive site" UI ships and 5-per-10-minutes turns out to be either too
-- tight for honest mapping work (a diver documenting several sites after one
-- trip) or still too loose against real abuse.
--
-- ---------------------------------------------------------------------
-- Not `security definer`, for the same reason 0006 isn't
-- ---------------------------------------------------------------------
-- Nothing about attaching to a fourth table changes this. The count query
-- runs as the invoking user, under RLS, against `sites` — which
-- `sites_select_public` (0002_rls.sql) makes readable to
-- `anon`/`authenticated` with `using (true)`. So the count sees every row it
-- needs to and cannot be evaded by a user hiding their own prior rows behind
-- RLS. Same property the other three tables' public-read policies give.

-- ---------------------------------------------------------------------
-- Attach to sites
-- ---------------------------------------------------------------------
create trigger sites_rate_limit
  before insert on sites
  for each row execute procedure public.enforce_submission_rate_limit(
    'created_by', 10, 5
  );

-- ---------------------------------------------------------------------
-- Supporting index for the trigger's own count query
-- ---------------------------------------------------------------------
-- 0006 added no index for the count query it introduced
-- (`select count(*) from <table> where <user_column> = $1 and created_at >
-- now() - interval '...'`), which was defensible for three small,
-- human-write-only tables. `sites` is the exception worth spending an index
-- on: it is the one table in this schema designed to grow continuously and
-- unattended (Task 21's OSM import), so the trigger's count would otherwise
-- become a sequential scan over an ever-growing table on *every* insert —
-- including every automated import insert, which then pays the scan cost
-- only to hit the `submitter is null` fail-open branch and discard it.
--
-- Partial (`where created_by is not null`) for exactly that reason: the
-- trigger only ever counts rows with a real submitter, and every
-- OSM-imported row has `created_by` NULL, so the imported bulk — the part
-- that actually grows — is excluded from the index entirely. Same partial-
-- index technique 0008's `sites_external_source_id_idx` already uses on this
-- table.
create index sites_created_by_created_at_idx
  on sites (created_by, created_at)
  where created_by is not null;

comment on index public.sites_created_by_created_at_idx is
  'Supports enforce_submission_rate_limit()''s per-user recent-row count on '
  'sites (0011). Partial on created_by is not null: OSM-imported rows '
  '(src/lib/sites/osm-import.ts) carry a NULL created_by and are never '
  'counted by that trigger, so excluding them keeps this index proportional '
  'to human submissions rather than to total table size.';
