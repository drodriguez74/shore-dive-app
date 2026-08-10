-- 0007_dive_plans.sql
-- Minimum-viable "Dive Plan" record (plan.md v5 Resolved Decision 5,
-- Task 11.5). Referenced throughout plan.md's Tasks 12/14/16 as "a user's
-- active dive plan" without ever being specced — three separate
-- implementers independently invented three different stand-ins
-- (`DivePlanCheckInState`, mock pre-trip-checklist dates, the Safe-Return
-- timer's own status as a proxy) because no shared table existed. This
-- migration is that table, written to the resolved minimum-viable
-- definition: "a lightweight record of {site(s), planned date/window,
-- optional 'diving with' label, status (planned/active/completed)}."
--
-- NOT YET APPLIED to any live project — same status as every other file in
-- this directory (see supabase/README.md "How to apply"). Written against
-- the schema 0001_init.sql/0002_rls.sql already established (profiles,
-- sites, provenance_state) — safe to apply after those, no other
-- dependency.
--
-- Distinct from, but linked to, the Safe-Return timer (Task 15): starting a
-- timer can optionally attach to an active dive plan, but a dive plan does
-- not require starting a timer, and this migration does not touch
-- Safe-Return's (currently localStorage-only, T15.7) state at all.

-- ---------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------
create type dive_plan_status as enum ('planned', 'active', 'completed');

-- ---------------------------------------------------------------------
-- dive_plans
-- ---------------------------------------------------------------------
create table dive_plans (
  id uuid primary key default gen_random_uuid(),
  -- Not nullable, unlike sites.created_by/hazard_reports.reported_by: this
  -- table is private per-user data (see RLS below), not a community
  -- contribution that should survive its author's account deletion in
  -- de-attributed form. A dive plan with no owner isn't a meaningful row,
  -- so it cascades instead of set-null.
  user_id uuid not null references profiles (id) on delete cascade,
  -- Nullable. Judgment call: plan.md's minimum-viable definition says
  -- "site(s)" (plural), which would properly be a join table
  -- (dive_plan_sites) for a real multi-site plan — out of scope for this
  -- migration's "minimum viable" mandate (Resolved Decision 5 is explicit
  -- this is the lightweight version, not the real multi-diver/multi-site
  -- model). Single nullable site_id is the MVP compromise: the site-detail
  -- "add to dive plan" action (Task 11.5) always sets it, but nullable
  -- leaves room for a future plan that isn't tied to exactly one documented
  -- site without an immediate schema break. on delete set null (not
  -- cascade) so deleting/removing a site doesn't silently destroy a user's
  -- private plan record.
  site_id uuid references sites (id) on delete set null,
  -- Split into a required date plus an optional free-text window
  -- ("7:00 AM", "morning", "low tide") rather than a single timestamptz or
  -- a tstzrange: plan.md's field list is "planned date/window", and shore
  -- diving's actual timing driver is tide/daylight, not a precise
  -- clock-time reservation (see plan.md's tide-link note) — a rigid
  -- timestamp column would overspecify a plan that's often genuinely
  -- fuzzy ("Saturday morning, whenever the tide's right").
  planned_date date not null,
  planned_window text,
  -- Buddy-system disclosure-level support (plan.md v5's Safety pillar
  -- addendum): NOT a real multi-diver/buddy-pair state model (that's the
  -- named, deferred future task) — just a free-text label so the
  -- Safe-Return disclaimer copy and dive-plan summary can say who a diver
  -- told they'd be diving with.
  diving_with text,
  status dive_plan_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dive_plans is
  'Minimum-viable dive plan record (plan.md v5 Resolved Decision 5). '
  'Private per-user data — RLS restricts all access to auth.uid() = '
  'user_id, unlike the publicly-readable sites/hazard_reports/lds_status '
  'tables. Distinct from but linked to the (currently local-only) '
  'Safe-Return timer: starting a timer may optionally reference a plan, '
  'but a plan does not require a timer.';

comment on column dive_plans.site_id is
  'Nullable — see migration header comment for the "site(s) plural" '
  'judgment call. In practice, Task 11.5''s "add to dive plan" action on '
  'the site detail page always sets this.';

comment on column dive_plans.diving_with is
  'Free-text "who you told you''re diving with" — the cheap, '
  'disclosure-level buddy-system support plan.md v5 calls for, not a real '
  'multi-diver check-in state model (that remains a named future task).';

create index dive_plans_user_id_idx on dive_plans (user_id);
create index dive_plans_site_id_idx on dive_plans (site_id);

create trigger dive_plans_set_updated_at
  before update on dive_plans
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS — owner-only, no public read
-- ---------------------------------------------------------------------
-- Unlike sites/hazard_reports/lds_status (public read, self-service write
-- capped at COMMUNITY provenance), dive_plans carries no provenance column
-- at all and is never publicly readable — it's genuinely private data
-- (a user's planned dive location/timing), the same tier P0-C already
-- names as PII ("dive-plan location"). Every policy is auth.uid() =
-- user_id, full stop.
alter table dive_plans enable row level security;

grant select, insert, update, delete on dive_plans to authenticated;

create policy dive_plans_select_own
  on dive_plans for select
  to authenticated
  using (auth.uid() = user_id);

create policy dive_plans_insert_own
  on dive_plans for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy dive_plans_update_own
  on dive_plans for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Delete IS allowed here, unlike sites/hazard_reports/lds_status (where
-- deleting published community content is a moderation action). A dive
-- plan has no moderation dimension — it's the owner's own private
-- record, so letting them cancel/remove it outright is the correct
-- self-service behavior, not a gap.
create policy dive_plans_delete_own
  on dive_plans for delete
  to authenticated
  using (auth.uid() = user_id);

-- No anon policy at all: signed-out users can neither read nor write any
-- row in this table, by omission (RLS defaults to deny with no matching
-- policy) as well as by the grant above only naming `authenticated`.
