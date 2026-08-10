-- 0006_rate_limiting.sql
-- Shore Dive — P0-B.4 hardening: DB-enforced rate limiting on self-service
-- provenance-tagged inserts.
--
-- 0002_rls.sql's header comment flags a gap explicitly: Postgres RLS can
-- express *who* can write which rows, but not *how often* — a signed-in
-- user could currently submit unlimited hazard_reports/lds_status rows.
-- That TODO sketches two options and recommends option (b), a Postgres
-- trigger that counts the submitting user's recent rows and raises an
-- exception past a threshold, "enforced no matter which client calls the
-- API." This migration builds that. Traces back to plan.md P0-B and
-- THREAT_MODEL.md §1 ("Rate-limit and require reputation/history before a
-- user's hazard report can flip a site's public status; log all
-- status-changing edits with attribution for abuse investigation").
--
-- Why a DB trigger over an application-layer check (see supabase/README.md
-- for the fuller writeup): a trigger runs inside Postgres itself, so it
-- holds no matter which code path performs the insert — the Supabase
-- client SDK called directly from the browser (this app's actual write
-- path today), a future server action, a one-off script, or the SQL
-- editor used by a signed-in low-trust client. An application-layer check
-- only protects the one code path it's added to, and "signed-in browser
-- client talks to Supabase directly" is exactly the case an app-layer
-- check is weakest against.
--
-- ---------------------------------------------------------------------
-- Scope: hazard_reports + lds_status (0002_rls.sql's named TODO), plus
-- camera_sources — judgment call, documented rather than left ambiguous
-- ---------------------------------------------------------------------
-- 0002_rls.sql's TODO names hazard_reports and lds_status explicitly (it
-- predates camera_sources, which was added later in
-- 0003_camera_sources.sql). This migration ALSO attaches the trigger to
-- camera_sources: camera_sources_insert_own's insert policy has the exact
-- same shape — self-service insert, capped at a non-privileged status
-- ('pending_review') via WITH CHECK, no rate limit — so it carries the
-- same abuse exposure 0002_rls.sql flags for the other two tables. The
-- trigger function below is written generically enough that covering a
-- third table costs one extra `create trigger` line, not new logic, so
-- there's little reason to leave a known-identical gap open. camera_sources
-- does have one independent mitigant hazard_reports/lds_status lack (a
-- unique index on source_url blocks literal duplicate-URL flooding), but a
-- user can still submit unlimited *distinct* URLs, so the exposure this
-- migration addresses is real, not hypothetical. Flagged for founder
-- review as a judgment call, same as the cap/window choice below — not
-- dictated by 0002_rls.sql's literal TODO text.
--
-- Explicitly NOT in scope (per the task that produced this migration):
--   - sites: not named in 0002_rls.sql's TODO, and has no live self-service
--     submission UI yet (unlike lds_status, see
--     src/components/lds/lds-submission-form.tsx, T16.3) to protect today.
--   - camera_sources' review/update (approve/reject) path: already
--     service-role-only per 0003_camera_sources.sql ("no update or delete
--     policy for authenticated users") — there is no user-facing write
--     path there to rate-limit in the first place.
--
-- ---------------------------------------------------------------------
-- Cap / window: 5 inserts per 10 minutes, per user, per table — judgment
-- call, nothing in plan.md/TASKS.md specifies a number
-- ---------------------------------------------------------------------
-- The only signal in scope docs is urgency ("before real community
-- submission UI ships"), not a target rate. Chosen conservatively:
--   - 10-minute window matches 0002_rls.sql's own sketch verbatim
--     (`... and created_at > now() - interval '10 minutes'`) — not a new
--     number invented here, the one already implicitly proposed.
--   - 5 rows per window per table is generous enough for genuine bursty
--     use (a diver logging conditions at several sites during one outing;
--     a shop correcting an LDS status right after a mistaken submission)
--     while still bounding a scripted/buggy client to a low double-digit
--     row count per hour instead of unbounded.
-- Not tuned against real traffic data, because there isn't any yet (no
-- live Supabase project, no real users — supabase/README.md's own header
-- flags everything here as unverified until applied). Revisit once real
-- community-submission usage patterns exist and either number looks wrong
-- in practice. Applied uniformly across all three tables for simplicity
-- rather than guessing a different number per table with nothing to
-- justify the difference; the cap/window are passed as trigger arguments
-- per table below, so splitting them apart later is a one-line change per
-- table, not a rewrite.
--
-- ---------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------
-- Reusable across tables: the user-attribution column name, window (in
-- minutes), and cap are passed in as trigger arguments (TG_ARGV) from each
-- `create trigger` call below, rather than hardcoding one table/column per
-- function. This mirrors 0001_init.sql's set_updated_at() in being a
-- small, generic, `for each row` trigger function attached to multiple
-- tables — but unlike handle_new_user() in 0001_init.sql (which is
-- `security definer` because it must insert into public.profiles from
-- within an auth.users insert, before the invoking session has any
-- profiles-table grant), this function runs entirely within the normal
-- RLS-enforced insert path, on tables the inserting authenticated user can
-- already SELECT from (see 0002_rls.sql's/0003_camera_sources.sql's
-- public-read policies) — it does not need, and deliberately does not use,
-- `security definer`.
create function public.enforce_submission_rate_limit()
returns trigger
language plpgsql
as $$
declare
  user_column text := TG_ARGV[0];
  window_minutes int := TG_ARGV[1]::int;
  max_rows int := TG_ARGV[2]::int;
  submitter uuid;
  recent_count int;
begin
  if TG_NARGS <> 3 then
    raise exception
      'enforce_submission_rate_limit() misconfigured on %: expected 3 '
      'trigger arguments (user_column, window_minutes, max_rows), got %',
      TG_TABLE_NAME, TG_NARGS;
  end if;

  -- Pull the submitting user's id off NEW dynamically, by column name, so
  -- one function works for reported_by (hazard_reports), created_by
  -- (lds_status), and added_by (camera_sources) alike.
  submitter := (to_jsonb(NEW) ->> user_column)::uuid;

  if submitter is null then
    -- Every insert policy this trigger protects (hazard_reports_insert_own,
    -- lds_status_insert_own, camera_sources_insert_own) already requires
    -- <user_column> = auth.uid() via WITH CHECK, so this branch should not
    -- be reachable in practice. Fail open rather than block a row with no
    -- user to count against — this is an anti-abuse control, not a
    -- safety-critical one (contrast the offline-cache integrity check in
    -- plan.md Task 12, which fails closed by design per CLAUDE.md).
    return new;
  end if;

  execute format(
    'select count(*) from %I where %I = $1 and created_at > now() - %L::interval',
    TG_TABLE_NAME,
    user_column,
    window_minutes || ' minutes'
  )
  into recent_count
  using submitter;

  if recent_count >= max_rows then
    raise exception
      'Rate limit exceeded: you can submit at most % row(s) to % per % '
      'minute(s). Please wait before submitting again.',
      max_rows, TG_TABLE_NAME, window_minutes
      using hint = 'This limit resets automatically once the window passes.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_submission_rate_limit() is
  'Generic before-insert rate-limit trigger (P0-B.4, THREAT_MODEL.md §1). '
  'Counts the inserting user''s rows created in the last <window_minutes> '
  'minutes (via the <user_column> trigger argument) and raises an '
  'exception at/past <max_rows>. Attached to hazard_reports, lds_status, '
  'and camera_sources — see this file''s header comment for the cap/'
  'window/scope judgment calls. Deliberately not security definer: runs '
  'in the normal RLS-enforced insert path, reading only tables the '
  'inserting user can already SELECT.';

-- ---------------------------------------------------------------------
-- Attach to hazard_reports and lds_status (0002_rls.sql's named TODO)
-- ---------------------------------------------------------------------
create trigger hazard_reports_rate_limit
  before insert on hazard_reports
  for each row execute procedure public.enforce_submission_rate_limit(
    'reported_by', 10, 5
  );

create trigger lds_status_rate_limit
  before insert on lds_status
  for each row execute procedure public.enforce_submission_rate_limit(
    'created_by', 10, 5
  );

-- ---------------------------------------------------------------------
-- Attach to camera_sources (judgment call — see header comment above)
-- ---------------------------------------------------------------------
create trigger camera_sources_rate_limit
  before insert on camera_sources
  for each row execute procedure public.enforce_submission_rate_limit(
    'added_by', 10, 5
  );
