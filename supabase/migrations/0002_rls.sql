-- 0002_rls.sql
-- Row-Level Security policies for the tables created in 0001_init.sql.
-- (P0-B.4, P0-C.3)
--
-- General shape, per plan.md/CLAUDE.md engineering standards ("No
-- unmoderated write path to provenance-tagged data"):
--   - anon + authenticated can READ sites/hazard_reports/lds_status
--     (this is a public discovery app, no login wall on browsing).
--   - only authenticated users can WRITE, and only as themselves
--     (created_by / reported_by must equal auth.uid()).
--   - self-service inserts/updates are forced to provenance = 'COMMUNITY'
--     via WITH CHECK — a user can never self-declare their own
--     submission 'VERIFIED'. Promoting COMMUNITY -> VERIFIED requires an
--     elevated path (service-role key / founder tooling) that bypasses
--     RLS entirely, since there's no moderator role modeled yet — see
--     supabase/README.md.
--   - profiles is private: a user can only read/update their own row.
--
-- IMPORTANT — rate limiting is NOT implemented here:
-- Postgres RLS policies can only express "who can read/write which
-- rows," not "how often." There is no built-in throttle. A malicious or
-- buggy client could currently submit unlimited hazard_reports/
-- lds_status rows as a signed-in user. TODO (not built here, flagged
-- for founder/future work): add either (a) an application-layer rate
-- limit in the API route/server action that performs the insert, or
-- (b) a Postgres trigger (e.g. `before insert on hazard_reports`) that
-- counts the submitting user's rows created in the last N minutes via
-- `select count(*) from hazard_reports where reported_by = auth.uid()
-- and created_at > now() - interval '10 minutes'` and raises an
-- exception past a threshold. Option (b) is enforced no matter which
-- client calls the API, so it's the more robust choice if this becomes
-- a real abuse vector — but it's explicitly out of scope for this
-- migration per THREAT_MODEL.md §1's "rate-limit and require
-- reputation/history" note, which is a Phase 2+ hardening item, not a
-- P0 blocker.

alter table profiles enable row level security;
alter table sites enable row level security;
alter table hazard_reports enable row level security;
alter table lds_status enable row level security;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
-- On a stock Supabase project, `anon`/`authenticated`/`service_role`
-- already have broad table-level grants set up by the platform itself,
-- with RLS policies (above) narrowing that down per-row. These GRANTs
-- are included explicitly anyway so this migration is correct and
-- self-contained on its own — table-level GRANTs and row-level RLS
-- policies are two independent layers in Postgres (a role needs both
-- table access AND a passing policy to touch a row), and depending
-- silently on undocumented platform defaults would leave this file
-- misleading to a future reader. Safe/idempotent to re-run.
grant usage on schema public to anon, authenticated;

grant select on sites, hazard_reports, lds_status to anon, authenticated;
grant insert, update on sites, hazard_reports, lds_status to authenticated;

grant select, insert, update on profiles to authenticated;

-- ---------------------------------------------------------------------
-- profiles — owner-only, no public read
-- ---------------------------------------------------------------------
create policy profiles_select_own
  on profiles for select
  to authenticated
  using (auth.uid() = id);

create policy profiles_update_own
  on profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Normally unnecessary (the on_auth_user_created trigger in
-- 0001_init.sql creates the row via security definer), but kept as a
-- safety net for reconciliation/manual upsert paths.
create policy profiles_insert_own
  on profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- No delete policy: account deletion should go through Supabase Auth
-- (which cascades via the FK to auth.users), not a direct row delete.

-- ---------------------------------------------------------------------
-- sites — public read, authenticated write, self-service capped at
-- COMMUNITY provenance
-- ---------------------------------------------------------------------
create policy sites_select_public
  on sites for select
  to anon, authenticated
  using (true);

create policy sites_insert_own
  on sites for insert
  to authenticated
  with check (created_by = auth.uid() and provenance = 'COMMUNITY');

create policy sites_update_own
  on sites for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and provenance = 'COMMUNITY');

-- No delete policy for authenticated users: deleting a published site
-- is a moderation action, not a self-service one. Founder/admin tooling
-- uses the service-role key, which bypasses RLS entirely.

-- ---------------------------------------------------------------------
-- hazard_reports — public read, authenticated write, self-service
-- capped at COMMUNITY provenance
-- ---------------------------------------------------------------------
create policy hazard_reports_select_public
  on hazard_reports for select
  to anon, authenticated
  using (true);

create policy hazard_reports_insert_own
  on hazard_reports for insert
  to authenticated
  with check (reported_by = auth.uid() and provenance = 'COMMUNITY');

create policy hazard_reports_update_own
  on hazard_reports for update
  to authenticated
  using (reported_by = auth.uid())
  with check (reported_by = auth.uid() and provenance = 'COMMUNITY');

-- No delete policy for authenticated users, same reasoning as sites.

-- ---------------------------------------------------------------------
-- lds_status — public read, authenticated write, self-service capped
-- at COMMUNITY provenance
-- ---------------------------------------------------------------------
create policy lds_status_select_public
  on lds_status for select
  to anon, authenticated
  using (true);

create policy lds_status_insert_own
  on lds_status for insert
  to authenticated
  with check (created_by = auth.uid() and provenance = 'COMMUNITY');

create policy lds_status_update_own
  on lds_status for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and provenance = 'COMMUNITY');

-- No delete policy for authenticated users, same reasoning as sites.
