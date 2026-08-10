-- 0001_init.sql
-- Shore Dive — Phase 0 schema (P0-A.6 schema portion, P0-B.1-P0-B.3)
--
-- Creates: profiles, sites, hazard_reports, lds_status.
-- RLS policies live in 0002_rls.sql (kept separate so schema and access
-- control can be reviewed/rolled out independently).
--
-- See supabase/README.md for the full design rationale, especially the
-- two-state provenance model decision and how it relates to the future
-- MODEL_INFERRED (Task 18) concept.

-- pgcrypto provides gen_random_uuid(); enabled by default on Supabase
-- projects, but declared here so this migration is self-contained.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

-- Two-state community-trust tier (plan.md P0-B, founder decision: kept
-- deliberately simple, not a four-tier model). Shared across sites,
-- hazard_reports, and lds_status so all provenance-tagged data uses one
-- vocabulary.
--
-- NOTE on MODEL_INFERRED (Task 18): per plan.md P0-B, AI-derived data
-- (e.g. webcam-based visibility/chop estimates) is *not* a third state
-- of this enum. It's a separate axis — "a data-quality signal, not a
-- community-trust tier" — and will live on its own table/columns
-- (confidence score + model version + timestamp) when Task 18 is built,
-- not as a value here. If a future need genuinely requires it on this
-- enum, `alter type provenance_state add value 'MODEL_INFERRED';` is a
-- safe, additive migration — but that's not expected given the plan.
create type provenance_state as enum ('VERIFIED', 'COMMUNITY');

-- Legal/access-status badge for a site (plan.md "Map-Driven Exploration"
-- pillar — the plan explicitly rejected geofuzzing coordinates in favor
-- of a visible access/legal-status badge for the one real distinct
-- concern: marine protected areas, seasonal closures, private-property
-- access). Nullable: most sites won't have a known restriction, and
-- "unknown/not yet assessed" is a legitimate state distinct from "open".
create type legal_access_status as enum (
  'open',
  'marine_protected_area',
  'seasonal_closure',
  'private_property',
  'restricted_other'
);

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
-- Deliberately minimal (P0-C): v1's PII surface is account identity via
-- Google OAuth only — no emergency contacts, no phone numbers (see
-- plan.md P0-C and THREAT_MODEL.md §11's deferred fuller PII posture).
-- One row per auth.users row, created automatically via the trigger
-- below so "populated on first sign-in" (P0-A.6) doesn't require any
-- app-code round trip.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table profiles is
  'Minimal per-user profile row. Identity itself (email, name, avatar) '
  'lives in auth.users via Google OAuth and is deliberately not '
  'duplicated here — see supabase/README.md PII section.';

-- Standard Supabase pattern: auto-create a profiles row when a new
-- auth.users row is inserted (i.e. on first successful Google sign-in).
-- security definer so it can insert into public.profiles despite the
-- invoking session having no profiles-table grants yet at that instant.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  provenance provenance_state not null default 'COMMUNITY',
  legal_access_status legal_access_status,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table sites is
  'Shore dive sites. Coordinates are exact (no geofuzzing) per plan.md '
  '"Map-Driven Exploration" — coastlines are public/walkable so hiding '
  'coordinates does not protect a genuinely secret resource. '
  'legal_access_status is the actual mitigation for the one real '
  'concern (MPAs, closures, private-property access).';

comment on column sites.legal_access_status is
  'Nullable = not yet assessed. Distinct from ''open'' which is an '
  'explicit "checked, no restriction known" state.';

create index sites_provenance_idx on sites (provenance);

-- ---------------------------------------------------------------------
-- hazard_reports
-- ---------------------------------------------------------------------
create table hazard_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  provenance provenance_state not null default 'COMMUNITY',
  description text not null,
  reported_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- updated_at exists (beyond the minimal field list) specifically so
  -- the freshness/staleness UI (Task 13, plan.md THREAT_MODEL.md §2/§8)
  -- can compute "as of [time]" client-side without a separate audit
  -- table. A report's author may correct it; that bumps updated_at but
  -- not created_at.
  updated_at timestamptz not null default now()
);

comment on table hazard_reports is
  'Community/verified hazard reports for a site. created_at/updated_at '
  'exist so the freshness UI (Task 13) can compute staleness without an '
  'extra table.';

create index hazard_reports_site_id_idx on hazard_reports (site_id);
create index hazard_reports_provenance_idx on hazard_reports (provenance);

-- ---------------------------------------------------------------------
-- lds_status (local dive shop / fill-station status)
-- ---------------------------------------------------------------------
-- Design choice: a single table, not a separate dive_shops entity table
-- (see supabase/README.md for the tradeoff). site_id is nullable
-- because a shop is not necessarily co-located with a documented dive
-- site. name/latitude/longitude live directly on this table so a shop
-- can be mapped even with no site_id set.
--
-- This can be used either as "one row per shop, updated in place" or
-- as an append-only verification log (insert a new row each time
-- someone confirms status, latest row per shop = current state) —
-- whichever Task 16 ends up needing; the schema supports both. The
-- append-only pattern mirrors hazard_reports and gives a natural audit
-- trail, so it's the recommended default (see README).
create table lds_status (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites (id) on delete set null,
  name text not null,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  status text not null default 'unknown'
    check (status in ('open', 'closed', 'limited', 'unknown')),
  provenance provenance_state not null default 'COMMUNITY',
  last_verified_at timestamptz not null default now(),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table lds_status is
  'Local dive shop / fill-station status. Never render status without '
  'last_verified_at in the UI (THREAT_MODEL.md §8) — a stale "open" is '
  'a stranding risk.';

create index lds_status_site_id_idx on lds_status (site_id);
create index lds_status_provenance_idx on lds_status (provenance);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sites_set_updated_at
  before update on sites
  for each row execute procedure public.set_updated_at();

create trigger hazard_reports_set_updated_at
  before update on hazard_reports
  for each row execute procedure public.set_updated_at();
