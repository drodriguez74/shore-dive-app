-- 0004_offline_bundles_storage.sql
-- Shore Dive — Task 12 (Intent-Driven Offline Cache), T12.1: Supabase
-- Storage bucket for offline bundle assets.
--
-- Task 12 pre-bundles site telemetry, hazard maps, and imagery ~24h before
-- a planned dive window so a site works with zero cellular coverage at the
-- water's edge (plan.md "Intent-Driven Offline Cache" pillar). The bundle
-- *files themselves* (JSON telemetry, hazard-map images, site photos) need
-- somewhere to live that a client can fetch offline-preparedness data from
-- ahead of time — this migration creates that bucket. It does not create an
-- upload route: per src/lib/offline/bundle-signing.ts and
-- bundle-verification.ts's header comments, the real
-- prepare-and-upload-a-bundle server flow is deliberately deferred until
-- this bucket actually exists (no live Supabase project exists yet —
-- TASKS.md P0-A.1 is a separate, still-open founder action). This migration
-- exists purely so the bucket/RLS are ready to apply the moment a live
-- project exists, following the same "SQL written ahead of a live project"
-- convention as 0001-0003 — see supabase/README.md.
--
-- THREAT_MODEL.md §2's core finding this bucket's shape has to respect:
-- "Cache poisoning / tampering ... a tampered hazard map is
-- indistinguishable from a legitimate one once cached" unless bundles are
-- signed/checksummed server-side and verified client-side (Resolved in
-- plan.md Task 12: bundle-signing.ts / bundle-verification.ts already do
-- that work). This migration's job is narrower: make sure *only* a
-- server-side, service-role process can ever write into this bucket, so
-- there's no path for a tampered file to land here in the first place that
-- doesn't also go through the signing step. Public *read* is fine and
-- intended — once a bundle is fetched and its checksums/signature verify
-- client-side, the underlying files are the same kind of public map/hazard
-- data the rest of this app already serves with no login wall (see
-- 0002_rls.sql's sites/hazard_reports/lds_status public-read policies).
--
-- Same "no unmoderated write path" shape as camera_sources' approve/reject
-- gate (0003_camera_sources.sql): there is no moderator/uploader role
-- modeled anywhere else in this schema yet, so — consistent with that file
-- and supabase/README.md's documented gap for VERIFIED promotion /
-- camera_sources approval — the only way to write into this bucket is the
-- Supabase service-role key (used by the future bundle-preparation route,
-- which bypasses RLS entirely by design). This is a reasonable v1 answer
-- given there's effectively one trusted operator (the founder); flagged
-- here the same way the other write-gap cases are flagged in
-- supabase/README.md, not invented as a new pattern.

-- ---------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------
-- `public = true` makes objects fetchable via Supabase's public object URL
-- (`/storage/v1/object/public/offline-bundles/...`) with no auth header —
-- required so a client can actually download bundle assets for offline use.
-- This does not weaken the integrity story: a public bucket only affects
-- *read* access, and every bundle file is still checksummed (per-file
-- SHA-256) and the manifest HMAC-signed server-side before the client ever
-- trusts it (bundle-signing.ts / bundle-verification.ts) — public read
-- means "anyone can download the bytes," not "anyone's downloaded bytes are
-- trusted without verification."
--
-- file_size_limit / allowed_mime_types are a judgment call, not specified
-- anywhere in plan.md/TASKS.md: bundle contents are described as "site
-- telemetry, hazard maps, and visual assets," so this allows structured
-- JSON, hazard-map/site imagery, and PDF hazard maps, capped at 20MB per
-- object (generous for a single photo or hazard-map image; a full bundle is
-- multiple objects, not one big blob). Revisit both once a real bundle is
-- actually produced and its real size/format profile is known.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'offline-bundles',
  'offline-bundles',
  true,
  20971520, -- 20 MiB per object
  array[
    'application/json',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Row-Level Security on storage.objects, scoped to this bucket
-- ---------------------------------------------------------------------
-- Unlike 0001-0003 (tables in the `public` schema, which this project
-- owns), `storage.objects` is a Supabase-platform-managed table that
-- already ships with RLS enabled and its own base-level grants to
-- anon/authenticated/service_role by default. This migration deliberately
-- does NOT re-issue `alter table ... enable row level security` or
-- schema/table-level `grant`s against `storage.objects` the way
-- 0002_rls.sql does for public-schema tables — doing so isn't the
-- documented/supported customization surface for Storage, and could fail
-- outright without owner privileges on a system table. The supported
-- surface is exactly what's below: bucket-scoped RLS policies. This is a
-- deliberate departure from 0002_rls.sql's "state every grant explicitly"
-- rationale, not an oversight — that rationale applies to schema we own.
--
-- Policy shape, mirroring camera_sources' service-role-only write gate:
--   - Public (anon + authenticated) read, scoped to this bucket only.
--   - No insert/update/delete policy for anon/authenticated at all — same
--     as camera_sources' approve/reject gap, there's no policy that would
--     let those roles write here, so none is granted. The only way to
--     upload/replace/delete a bundle object is the service-role key (used
--     by the future bundle-preparation route once T12.1's bucket + a real
--     upload flow are wired together), which bypasses RLS entirely.

create policy offline_bundles_select_public
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'offline-bundles');

comment on policy offline_bundles_select_public on storage.objects is
  'Public read for offline bundle assets (Task 12) — bundle files are '
  'public map/hazard data, same trust level as sites/hazard_reports, and '
  'must be fetchable client-side for offline caching. See '
  'supabase/README.md and THREAT_MODEL.md §2.';

-- No insert/update/delete policy for anon/authenticated, deliberately —
-- see the header comment above and supabase/README.md. Only the
-- service-role key (bypasses RLS) can write into this bucket.
