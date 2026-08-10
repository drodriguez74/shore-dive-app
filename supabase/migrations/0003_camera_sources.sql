-- 0003_camera_sources.sql
-- Shore Dive — Phase 3 schema (T17.1: `camera_sources` allowlist table)
--
-- This table *is* the allowlist described in plan.md's Phase 3 sourcing
-- model: "allowlist/partnership-based, not indiscriminate scraping —
-- only ingest feeds from sources with explicit permission (municipal
-- open-data feeds, opted-in dive shops/park services)." Nothing in this
-- table is usable/embeddable by the app until a row's `status` is
-- 'approved' — that's the gate. It also doubles as the landing table for
-- Task 19's candidate-discovery agent: candidates land here as
-- 'pending_review' and must go through human approval before they're
-- ever treated as a trusted source or shown to the public
-- (THREAT_MODEL.md §9's "never auto-publish a newly discovered camera").
--
-- Follows the style/conventions of 0001_init.sql/0002_rls.sql: enums for
-- controlled vocabularies, `created_by`-style attribution FKs to
-- `profiles` with `on delete set null`, and RLS split from schema is
-- *not* done here (unlike 0001/0002) because this table is small enough
-- and self-contained enough to review as one unit — see supabase/README.md.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

-- The allowlist gate itself. 'pending_review' is the only status a
-- self-service insert can ever produce (enforced via RLS WITH CHECK
-- below, mirroring how 0002_rls.sql caps sites/hazard_reports/lds_status
-- inserts at provenance = 'COMMUNITY'). Only 'approved' rows are ever
-- treated as trusted/embeddable — see the public-read policy below and
-- the media-embed component (src/components/media-embed) which expects
-- to be fed only approved sources once this table is wired up to it.
create type camera_source_status as enum (
  'pending_review',
  'approved',
  'rejected'
);

-- ---------------------------------------------------------------------
-- camera_sources
-- ---------------------------------------------------------------------
create table camera_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- The stream/embed URL itself (an HLS/.m3u8 endpoint, a direct video
  -- URL, or a third-party embeddable player page — the media-embed
  -- component's fallback chain decides how to render it). Deliberately
  -- not typed/validated at the DB level beyond not-null; format
  -- validation belongs to the ingestion connector (T17.2) and the
  -- media-embed component's own domain allowlist (T20.2), which is a
  -- separate, code-level allowlist scoped to embeddable *players* and
  -- deliberately NOT derived from this column (decided in T20.2's
  -- follow-up — see src/components/media-embed/allowlist.ts and
  -- supabase/README.md's "Relationship to..." section). The two staying
  -- out of sync is checked for, not prevented, by
  -- src/lib/camera-sources/embed-allowlist-consistency.ts.
  source_url text not null,
  -- Nullable: a camera doesn't necessarily map 1:1 to a documented dive
  -- site (e.g. a municipal beach-parking-lot cam near several sites, or
  -- a cam covering a stretch of coastline with no single associated
  -- site row yet).
  site_id uuid references sites (id) on delete set null,
  status camera_source_status not null default 'pending_review',
  added_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Both null until a human reviewer acts on the row (approve/reject).
  -- Nullable rather than defaulted, so "never reviewed" is distinguishable
  -- from any real timestamp.
  reviewed_at timestamptz,
  reviewed_by uuid references profiles (id) on delete set null,

  -- A row can't claim to be reviewed by someone without a review time,
  -- or vice versa — keeps the two columns consistent at the schema
  -- level rather than relying on every writer to set both together.
  constraint camera_sources_review_fields_consistent check (
    (reviewed_at is null and reviewed_by is null)
    or (reviewed_at is not null)
  ),

  -- A still-pending row shouldn't have review fields populated; a
  -- decided row (approved/rejected) should have been reviewed. Guards
  -- against a status flip that forgets to stamp who/when reviewed it.
  constraint camera_sources_status_review_consistent check (
    (status = 'pending_review' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

comment on table camera_sources is
  'The camera allowlist (plan.md Phase 3 sourcing model, T17.1). Rows '
  'start as pending_review (self-service insert or Task 19''s discovery '
  'agent) and only become usable/embeddable once a human reviewer flips '
  'status to approved. Never treat a non-approved row as a trusted '
  'source. See supabase/README.md for the RLS/moderation rationale.';

comment on column camera_sources.status is
  'The allowlist gate. pending_review = candidate, not yet usable. '
  'approved = trusted, safe to render via the media-embed component. '
  'rejected = reviewed and declined (kept for audit/dedup, not deleted).';

comment on column camera_sources.site_id is
  'Nullable — a camera does not necessarily map 1:1 to a documented '
  'dive site, same reasoning as lds_status.site_id in 0001_init.sql.';

-- Duplicate-candidate guard: Task 19's discovery agent (and manual
-- submitters) could otherwise flood the moderation queue with the same
-- URL repeatedly. A hard uniqueness constraint is a simple, DB-level
-- way to keep the queue reviewable without needing dedup logic in every
-- writer. If a legitimate need for the same URL twice ever comes up
-- (e.g. re-adding a previously rejected source under a new name), that's
-- a judgment call for whoever builds T19.3 to revisit.
create unique index camera_sources_source_url_key on camera_sources (source_url);

create index camera_sources_status_idx on camera_sources (status);
create index camera_sources_site_id_idx on camera_sources (site_id);

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
-- Shape, matching 0002_rls.sql's pattern for provenance-tagged tables:
--   - Public (anon + authenticated) read access is limited to `approved`
--     rows only. This is the important departure from sites/hazard_reports
--     /lds_status, which are publicly readable regardless of provenance:
--     here, pending/rejected candidates must stay invisible to regular
--     users. Task 19's whole design depends on this — its output lands
--     in a moderation queue that is explicitly NOT public until a human
--     approves it (THREAT_MODEL.md §9).
--   - A signed-in user can also read their own submitted candidates
--     regardless of status (a small addition beyond the literal "public
--     read = approved only" requirement, since letting someone see their
--     own pending/rejected submission isn't a public-visibility leak —
--     it mirrors the profiles table's owner-only read pattern). Remove
--     this policy if a future moderation-queue UI (T19.2) wants the
--     queue to be reviewer-only and not visible to the original
--     submitter for some reason.
--   - Authenticated users can INSERT a new candidate, but the WITH CHECK
--     clause forces status = 'pending_review' and added_by = auth.uid() —
--     the exact same self-escalation-prevention shape 0002_rls.sql uses
--     to stop a self-service insert from claiming provenance = 'VERIFIED'.
--     A normal user can never insert a row that is already 'approved'.
--   - There is deliberately NO update policy for authenticated users.
--     Approving/rejecting a candidate (status transition + stamping
--     reviewed_at/reviewed_by) is a moderation action, and — same as
--     0002_rls.sql's documented answer for promoting COMMUNITY ->
--     VERIFIED — there's no moderator role modeled in this schema yet.
--     That path requires the Supabase service-role key (founder/admin
--     tooling, or eventually T19.2's moderation-queue UI running with
--     elevated privilege), which bypasses RLS entirely. This is the
--     same "requires service-role, no role system invented here" gap
--     0002_rls.sql flags for sites/hazard_reports/lds_status — see
--     supabase/README.md for the TODO writeup. No delete policy either,
--     for the same reason (rejecting a row, not deleting it, is the
--     intended path — keeps a record for dedup/audit).

alter table camera_sources enable row level security;

grant usage on schema public to anon, authenticated;
grant select on camera_sources to anon, authenticated;
grant insert on camera_sources to authenticated;
-- No update/delete grants for anon/authenticated: every status
-- transition (approve/reject) is a service-role-only action, so there's
-- no policy that would ever let those grants do anything anyway — left
-- out entirely (rather than granted-but-unused) so the table-level
-- grants and the RLS policies below agree on the same story at a glance.

create policy camera_sources_select_approved
  on camera_sources for select
  to anon, authenticated
  using (status = 'approved');

create policy camera_sources_select_own
  on camera_sources for select
  to authenticated
  using (added_by = auth.uid());

create policy camera_sources_insert_own
  on camera_sources for insert
  to authenticated
  with check (added_by = auth.uid() and status = 'pending_review');

-- No update or delete policy for authenticated users — see the RLS
-- comment block above. Approve/reject requires the service-role key.
