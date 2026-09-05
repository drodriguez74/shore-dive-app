-- 0015_area_research_log.sql
-- Shore Dive — map-pan AI-assisted discovery fallback (plan.md Resolved
-- Spec Decision #10, 2026-08-11): a lightweight log table purely for
-- daily-call-cap accounting, mirroring `webcam_readings`' role for
-- `src/lib/webcam-extraction/rate-cap.ts`'s `countReadingsToday()`.
-- Candidates found by a research call are never persisted here or anywhere
-- else unless a diver explicitly adds one to the map (`POST
-- /api/sites/candidates/add`, which inserts a real `sites` row) — this
-- table only records that a `researchDiveSitesNear()` call happened, when,
-- by whom, and how many candidates it returned, so
-- `src/lib/site-discovery/rate-cap.ts` can count today's calls against
-- `AREA_RESEARCH_DAILY_CALL_CAP`.

create table area_research_log (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references profiles (id) on delete set null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  candidate_count integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table area_research_log is
  'Call log for the map-pan AI-assisted discovery fallback (Brave Search + '
  'Gemini extraction) — accounting only, never candidate storage. Every '
  'researchDiveSitesNear() call writes one row here regardless of outcome, '
  'so src/lib/site-discovery/rate-cap.ts can enforce '
  'AREA_RESEARCH_DAILY_CALL_CAP the same way webcam-extraction/rate-cap.ts '
  'counts webcam_readings.';

comment on column area_research_log.candidate_count is
  'How many candidates this call returned to the caller — not how many '
  'were ever added to sites. Informational only; not used by the rate cap '
  'itself.';

create index area_research_log_created_at_idx on area_research_log (created_at);

-- Same generic rate-limit trigger every other self-service-insert table
-- uses (0006_rate_limiting.sql) — 5 inserts per 10 minutes per user, same
-- cap/window as hazard_reports/lds_status/camera_sources/sites (0011), no
-- new judgment call. This governs how often ONE signed-in user can trigger
-- the underlying Brave+Gemini pipeline; AREA_RESEARCH_DAILY_CALL_CAP
-- (src/lib/site-discovery/rate-cap.ts) separately caps total calls across
-- ALL users per day, protecting both providers' free-tier ceilings the
-- same two-tier way search-nearby's Overpass fallback is already capped
-- (per-cell/per-user gate + a separate global daily cap,
-- external-search-cache.ts).
create trigger area_research_log_rate_limit
  before insert on area_research_log
  for each row execute procedure public.enforce_submission_rate_limit(
    'requested_by', 10, 5
  );

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
-- The route that inserts into this table (POST /api/sites/research-area)
-- writes through the signed-in user's own server client, not the
-- service-role client — so RLS's WITH CHECK below is what actually binds
-- requested_by = auth.uid(), the same way sites_insert_own
-- (0002_rls.sql) binds created_by. That matters here specifically because
-- enforce_submission_rate_limit() reads requested_by off the inserted
-- row (0011's header explains why) — an admin-client insert with no RLS
-- check could write any requested_by value, silently breaking the
-- per-user rate limit.
--
-- The DAILY cap (src/lib/site-discovery/rate-cap.ts) needs a GLOBAL count
-- across all users, which a per-row "read your own" policy cannot supply
-- — that count query runs through the service-role client instead
-- (src/lib/supabase/admin.ts), same as run-extraction.ts's
-- countReadingsToday(). The select policy below exists for a possible
-- future "your own research history" UI, not for the cap check.

alter table area_research_log enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert on area_research_log to authenticated;

create policy area_research_log_select_own
  on area_research_log for select
  to authenticated
  using (requested_by = auth.uid());

create policy area_research_log_insert_own
  on area_research_log for insert
  to authenticated
  with check (requested_by = auth.uid());
