-- 0005_webcam_readings.sql
-- Shore Dive — Phase 3 schema (T18.3: `webcam_readings` extraction results)
--
-- Storage for the Visual Telemetry Extraction Pipeline (plan.md Task 18,
-- THREAT_MODEL.md §9): a vision-model worker estimates water visibility and
-- chop/sea-state from an approved webcam's still frame, and this table is
-- where that estimate lands. Every row is a `MODEL_INFERRED` reading
-- (P0-B) — a data-quality signal, not a community-trust tier, independent
-- of the `provenance_state` enum in 0001_init.sql (see supabase/README.md's
-- "Why MODEL_INFERRED isn't in the provenance_state enum" section, which
-- flagged this exact table as where it would eventually live).
--
-- THREAT_MODEL.md §9 is explicit that this is a second life-safety-adjacent
-- data path (alongside §2's offline-bundle integrity): a fogged lens, a
-- misaimed camera, a stale frame served as if live, or a plain model error
-- can produce a wrong "good visibility" signal a diver could rely on. The
-- schema-level mitigation is the same one the UI layer implements
-- (src/components/webcam-readings/reading-badge.tsx, T18.4, reusing
-- src/components/provenance-badge.tsx's existing MODEL_INFERRED treatment):
-- every reading carries a mandatory confidence score, the exact model
-- identifier that produced it, and both a capture timestamp and a
-- created/inserted timestamp, so nothing downstream can render an inferred
-- reading with the same visual weight as verified hazard data or hide how
-- old/uncertain it is.
--
-- Follows 0003_camera_sources.sql's convention of keeping a small,
-- self-contained addition (schema + RLS) in one file rather than splitting
-- schema from RLS the way 0001/0002 do.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

-- Categorical sea-state/chop estimate. Deliberately does not include an
-- 'unknown' member — a model that can't confidently characterize chop
-- should report NULL (see the chop_state column below) and let the
-- `confidence` score carry the uncertainty signal, rather than encoding
-- "unknown" as if it were an observed state alongside real ones.
create type webcam_chop_state as enum (
  'calm',
  'light',
  'moderate',
  'rough',
  'severe'
);

-- ---------------------------------------------------------------------
-- webcam_readings
-- ---------------------------------------------------------------------
create table webcam_readings (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately `on delete cascade`, unlike camera_sources.site_id's
  -- `on delete set null` (0003_camera_sources.sql): a reading with no
  -- camera to attribute it to is meaningless and shouldn't be kept around
  -- as an orphaned row, whereas a camera losing its (optional) site link
  -- is still a meaningful camera.
  camera_source_id uuid not null references camera_sources (id) on delete cascade,
  -- Estimated horizontal underwater visibility in meters. Nullable: the
  -- model may be confident about chop but not visibility (or vice versa)
  -- from a single surface-level still frame — forcing a non-null value
  -- would mean fabricating a number rather than honestly reporting "not
  -- estimated." numeric(5,2) comfortably covers real-world visibility
  -- ranges (0-999.99m) with 2 decimal places of (spurious but harmless)
  -- precision.
  visibility_meters numeric(5, 2) check (visibility_meters is null or visibility_meters >= 0),
  chop_state webcam_chop_state,
  -- 0-1. Not nullable — unlike the two estimate fields above, every
  -- extraction attempt that produces a row at all must carry a confidence
  -- score; a reading with no confidence value would be indistinguishable
  -- from a verified one to any code that forgets to check for it.
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  -- Exact model identifier/version string used for this extraction (e.g.
  -- 'claude-haiku-4-5-20251001') — see src/lib/webcam-extraction/model.ts for where
  -- this value comes from and why that file, not this column, is the
  -- single source of truth for "which model is currently in use." Stored
  -- per-row (not just logged) so a future UI/analytics pass can answer
  -- "which readings came from which model version" without cross-
  -- referencing deploy history — model choice is expected to change over
  -- time (cost, capability, pricing), and old rows should keep saying what
  -- actually produced them.
  model_id text not null,
  -- When the underlying webcam frame was captured (source-reported or, if
  -- the source doesn't provide one, the time the worker fetched it) — the
  -- timestamp a diver's "how current is this" judgment should be based on.
  -- Distinct from created_at (T18.5's rate-cap window) below, which is
  -- about server-side bookkeeping, not the diver-facing freshness story.
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table webcam_readings is
  'Vision-model-inferred visibility/chop estimates from approved webcam '
  'sources (Task 18, T18.3). Every row is MODEL_INFERRED (P0-B) — render '
  'only via src/components/webcam-readings/reading-badge.tsx (which wraps '
  'ProvenanceBadge), never with the same visual weight as VERIFIED/'
  'COMMUNITY data. See THREAT_MODEL.md §9: a bad inference here feeds the '
  'same safety-adjacent decision path as hazard_reports.';

comment on column webcam_readings.visibility_meters is
  'Estimated horizontal visibility in meters. NULL means the model did '
  'not produce a visibility estimate for this frame — not zero visibility.';

comment on column webcam_readings.chop_state is
  'Categorical sea-state/chop estimate. NULL means not estimated (see '
  'the confidence column for how much to trust readings that are '
  'present) — never encoded as a separate ''unknown'' enum member.';

comment on column webcam_readings.confidence is
  'Model-reported confidence, 0-1. Mandatory on every row — this is the '
  'primary signal the UI (T18.4) and any future go/no-go logic must '
  'weigh a MODEL_INFERRED reading by.';

comment on column webcam_readings.model_id is
  'Exact model identifier/version that produced this reading (see '
  'src/lib/webcam-extraction/model.ts). Stored per-row so historical '
  'readings keep an honest record even after the worker moves to a '
  'different model.';

comment on column webcam_readings.captured_at is
  'When the source webcam frame was captured — the diver-facing '
  'freshness timestamp. Distinct from created_at, which is server-side '
  'insert bookkeeping (see T18.5''s daily rate-cap, which counts by '
  'created_at, not captured_at).';

create index webcam_readings_camera_source_id_idx on webcam_readings (camera_source_id);
create index webcam_readings_captured_at_idx on webcam_readings (captured_at);
-- Supports T18.5's hard daily call-volume cap: the worker counts today's
-- rows by created_at before making another vision-API call. An index here
-- keeps that count cheap even as the table grows.
create index webcam_readings_created_at_idx on webcam_readings (created_at);

-- ---------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------
-- Shape:
--   - Public (anon + authenticated) read access, unconditionally — unlike
--     camera_sources' approved-only read gate. The moderation gate for
--     "is this camera trustworthy enough to extract from at all" already
--     happened one table over (camera_sources.status = 'approved', T17.1,
--     enforced by the worker's own source-selection query, see
--     src/lib/webcam-extraction/run-extraction.ts); a row existing in this
--     table at all means it came from an already-approved source. What
--     keeps a reading from being mistaken for verified data is the
--     mandatory MODEL_INFERRED badge treatment (T18.4) at render time, not
--     restricting who can read it — this is a feed diver go/no-go
--     decisions may depend on, so it must be visible the same way
--     hazard_reports/lds_status are (same "no bare/undifferentiated badge,
--     but never hidden" reasoning as plan.md's Map-Driven Exploration
--     pillar).
--   - No insert/update/delete policy for anon or authenticated, at all.
--     Writing a webcam_readings row is exclusively the scheduled worker's
--     job (T18.2, src/app/api/cron/webcam-extraction/route.ts), which runs
--     with the Supabase service-role key (src/lib/supabase/admin.ts)
--     and therefore bypasses RLS entirely. This is the same, explicitly
--     documented "no role system invented here — service-role required"
--     gap that 0002_rls.sql (VERIFIED promotion) and 0003_camera_sources.sql
--     (approve/reject) both already carry: a real moderator/worker role
--     model is future work, not something this migration should paper over
--     by inventing a one-off role or a permissive policy just to avoid the
--     gap. Table-level grants below intentionally omit insert/update/delete
--     for anon/authenticated for the same reason 0003 does — no policy
--     would ever make those grants do anything, so they're left out rather
--     than granted-but-unused.

alter table webcam_readings enable row level security;

grant usage on schema public to anon, authenticated;
grant select on webcam_readings to anon, authenticated;

create policy webcam_readings_select_all
  on webcam_readings for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy for anon/authenticated — see the RLS
-- comment block above. Every write goes through the service-role key.
