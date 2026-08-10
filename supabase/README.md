# Supabase schema — Shore Dive

Covers `TASKS.md` P0-B.1–P0-B.4 (data provenance schema + RLS), the schema
portion of P0-A.6 (`profiles` table), and P0-C.2 (data-retention policy).
Traces back to `plan.md` P0-A/P0-B/P0-C and `THREAT_MODEL.md` §1, §2, §8, §11.

No Supabase project exists yet (`TASKS.md` P0-A.1 is an open founder action —
external account creation). Nothing here has been run against a live
database. It's written as standard, plain Postgres/Supabase SQL and reviewed
for syntax, but treat it as unverified until it's actually applied once and
`supabase db diff`/a manual smoke test confirms it behaves as expected.

## Files

- `migrations/0001_init.sql` — enums, tables (`profiles`, `sites`,
  `hazard_reports`, `lds_status`), the `handle_new_user` trigger, and the
  `updated_at` maintenance trigger.
- `migrations/0002_rls.sql` — Row-Level Security, split into its own file so
  schema and access-control changes can be reviewed/rolled out separately.
- `migrations/0003_camera_sources.sql` — the `camera_sources` allowlist table
  (T17.1) and its RLS, schema and policies together in one file (unlike
  0001/0002) since it's a small, self-contained addition — see below.
- `migrations/0004_offline_bundles_storage.sql` — the `offline-bundles`
  Supabase Storage bucket (T12.1) and its RLS on `storage.objects`, bucket
  creation and policies together in one file (same reasoning as 0003) — see
  below.
- `migrations/0005_webcam_readings.sql` — the `webcam_readings` table (T18.3)
  storing the vision-model worker's `MODEL_INFERRED` visibility/chop
  estimates, schema and RLS together (same one-file convention as 0003). This
  is the table the "Why `MODEL_INFERRED` isn't in the `provenance_state`
  enum" section below said Task 18 would eventually need.
- `migrations/0006_rate_limiting.sql` — a reusable Postgres trigger
  (`enforce_submission_rate_limit()`) enforcing a per-user submission rate
  limit on `hazard_reports`, `lds_status`, and `camera_sources` inserts
  (P0-B.4). Resolves the gap `0002_rls.sql`'s header comment flagged — see
  "Rate limiting on self-service inserts" below.
- `migrations/0007_dive_plans.sql` — the `dive_plans` table (`plan.md` v5
  Resolved Decision 5 / Task 11.5's minimum-viable Dive Plan record) and its
  RLS, schema and policies together in one file (same one-file convention as
  0003/0005). Resolves open item 5 below. See "`dive_plans` — private,
  owner-only, not part of the public provenance model" below for why this
  table's RLS shape departs from every other table in this file.
- `migrations/0008_sites_external_source.sql` — nullable `external_source`/
  `external_id` columns on `sites` plus a partial unique index on
  `(external_source, external_id)` (Task 21 / `plan.md` v5 Resolved
  Decision #6, T21.1), so the on-demand OpenStreetMap import pipeline
  (`src/lib/sites/osm-import.ts`, T21.2) can never import the same upstream
  node twice. No RLS change — see "External dive-site sourcing" below.
- `migrations/0009_external_search_area_cache.sql` — the
  `external_search_area_cache` table (Task 21, T21.3): a per-area ~30-day
  cooldown ledger (corrected same-day from an original 24h spec — see the
  migration's own header comment) gating how often the on-demand search route
  (`src/app/api/sites/search-nearby/route.ts`) is allowed to call the
  external Overpass API for the same rough geographic area, respecting its
  fair-use policy. Kept in its own file rather than folded into 0008 — see
  that migration's header comment for why.
- `migrations/0010_sites_site_type.sql` — a `site_type` enum/column on
  `sites` (Task 21, T21.5 data-layer half, `plan.md` v5 Resolved Decision #7)
  classifying what kind of site each row is (`shore_reef`/`shipwreck`/
  `cave`/`spring`/`artificial_reef`/`unclassified`) for future map-icon
  rendering — `not null default 'unclassified'`, plus `sites_site_type_idx`.
  The OSM tag mapping that populates this column
  (`src/lib/sites/osm-import.ts`'s `deriveSiteType`) was live-verified
  against overpass-api.de during this pass — see that function's own header
  comment and the migration's for the full research writeup. **Schema/import
  half only** — the map-icon-rendering half of T21.5 is separate, in-flight
  work, and still needs the `creative/AESTHETIC_REVIEW.md` design pass
  `TASKS.md`'s `T21.5` entry flags before real icon artwork lands.
- `migrations/0011_sites_rate_limit.sql` — attaches `0006`'s existing
  `enforce_submission_rate_limit()` trigger to `sites`, the fourth and last
  self-service-insertable table (T21.16). No new logic — one `create trigger`
  call reusing 0006's per-table arguments, plus a partial supporting index on
  `(created_by, created_at)`. Reverses 0006's original "not attached to
  `sites`" scoping decision, whose stated reason has since aged out. See
  "Rate limiting on self-service inserts" below for what it covers and what
  it deliberately does not.
- `migrations/0012_sites_dive_metadata.sql` — the schema multi-catalogue
  aggregation needs (Task 21, T21.21): `depth_min_ft`/`depth_max_ft` on
  `sites` (nullable, **feet**, with min ≤ max and non-negative CHECKs), a
  `shore_access_confidence` enum + `shore_access`/`shore_entry_id`/
  `shore_distance_yards` columns recording the derived shore-access
  classification *and the evidence it was derived from*, and a new
  `site_sources` table (one row per site/upstream-catalogue/upstream-id)
  replacing `0008`'s single-source columns. Schema + RLS in one file, same
  convention as 0003/0005/0007. **Not applied** — Open item #15. See
  "Dive metadata and multi-source provenance" below.
- `seed.sql` — 3 example `VERIFIED` sites for local dev / smoke testing. Not
  the real content seed (see below).

## How to apply

The Supabase CLI is **not installed in this repo yet**. Two ways to apply
these once a real Supabase project exists (P0-A.1):

**Option A — Supabase CLI (once installed and linked to a project):**
```
supabase link --project-ref <your-project-ref>
supabase db push
```
This applies every file under `migrations/` in filename order. To also load
the starter seed data locally: `supabase db reset` (local dev only — this
drops and recreates the local shadow database, don't run it against a linked
remote project unless you mean to wipe it).

**Option B — Supabase SQL editor (no CLI needed):**
Open the project's SQL editor in the Supabase dashboard and paste/run
`migrations/0001_init.sql`, then `migrations/0002_rls.sql`, in that order.
Optionally follow with `seed.sql` for starter data. This is the simpler path
if the CLI isn't set up yet — nothing here requires the CLI specifically,
it's just plain DDL.

The `0001`/`0002` numeric prefix is a simplified naming scheme for this
initial hand-written batch. The Supabase CLI's own `supabase migration new
<name>` generates timestamp-prefixed filenames (e.g.
`20260805120000_init.sql`) once the CLI is actually in use — feel free to
rename these to fit that convention when the CLI is installed and linked;
the numeric prefixes here are only for readability before that point.

## Schema design rationale

### Provenance model: two states, not four

Every provenance-tagged table (`sites`, `hazard_reports`, `lds_status`) uses
a shared `provenance_state` enum with exactly two values: `VERIFIED` and
`COMMUNITY`. This directly follows the founder decision recorded in
`plan.md` P0-B: *"Every map pin, hazard status, and LDS status is tagged
VERIFIED ... or COMMUNITY ... simplified from an earlier four-tier design —
expand later once there's more than one contributor."* Don't reintroduce a
finer-grained trust tier here without checking with the founder first — it
was deliberately simplified down, not an oversight.

### Why `MODEL_INFERRED` isn't in the `provenance_state` enum

`plan.md` P0-B is explicit that AI-derived data (Task 18's webcam
visibility/chop estimates) is *"a data-quality signal, not a
community-trust tier, independent of the Verified/Community split."* So it
deliberately isn't a third value on this enum — it's a different axis
entirely (a confidence score + model version + timestamp), and per the plan
it'll live on Task 18's own table when that's built, not by extending
`sites`/`hazard_reports`/`lds_status`. If a future need genuinely requires
tagging a row in one of *these* tables as model-inferred, `alter type
provenance_state add value 'MODEL_INFERRED'` is a safe additive migration —
but nothing in the current plan calls for that, so it's left out rather than
speculatively added.

### `legal_access_status` as its own enum, nullable

`plan.md`'s "Map-Driven Exploration" pillar explicitly rejected geofuzzing
coordinates (dive sites are on public, walkable coastline — hiding a pin
doesn't protect a genuinely secret resource) in favor of an explicit
access/legal-status badge for the one real distinct concern: marine
protected areas, seasonal closures, and private-property access. That badge
is modeled as its own enum (`open` / `marine_protected_area` /
`seasonal_closure` / `private_property` / `restricted_other`), nullable to
distinguish "not yet assessed" from an explicit "checked, no restriction" —
`open` is that latter, deliberate state.

### `lds_status`: one table, not a separate `dive_shops` entity

`TASKS.md` P0-B.3 left the site-vs-shop-reference question as a judgment
call ("a shop isn't necessarily a dive site"). I went with a single
`lds_status` table carrying its own `name`/`latitude`/`longitude` plus a
**nullable** `site_id`, rather than splitting out a separate `dive_shops`
entity table. Reasoning:
- It matches the literal column list in the task description (`name`,
  `status`, `provenance`, `last_verified_at`, `created_by` are all read as
  columns of `lds_status` itself).
- Task 16 (LDS logistics layer) hasn't been built yet — a full shop entity
  table (with its own edit history, ownership, etc.) is speculative
  architecture for a feature that doesn't exist. Simpler now, easy to split
  out later if Task 16's real requirements need it.
- `site_id` stays nullable and optional: a shop can be mapped and shown
  without being tied to a specific documented dive site.

**Judgment call, flagged for review:** this table can be used two ways —
(a) one row per shop, updated in place, or (b) an append-only log where each
verification inserts a new row and "current status" = the latest row per
shop (matched by `site_id`+`name`, since there's no shop-identity FK). I
recommend (b) — it mirrors `hazard_reports`, gives a natural audit trail,
and fits the freshness/staleness UI pattern `THREAT_MODEL.md` §8 calls for
("never show a binary open/closed status without a last-verified time").
But whoever builds Task 16 should confirm this before writing the first
query against it, since it changes how "current status per shop" is
fetched (`select distinct on (...) ... order by last_verified_at desc` vs. a
plain row read).

### `profiles`: minimal by design

Per `plan.md` P0-C, v1's PII surface is intentionally small — account
identity (via Google OAuth, in `auth.users`, not duplicated here),
dive-plan location, and Safe-Return timer state. No emergency contacts, no
phone numbers. `profiles` is just `id` (FK to `auth.users`) + `created_at`.
The `handle_new_user()` trigger in `0001_init.sql` auto-creates a `profiles`
row on first Google sign-in (standard Supabase pattern), so "populated on
first sign-in" (P0-A.6) doesn't require any app-code round trip — though the
app is still free to `upsert` defensively if that's simpler for the auth
flow being built.

### RLS: self-service writes are capped at `COMMUNITY`

Every insert/update policy on `sites`, `hazard_reports`, and `lds_status`
includes `provenance = 'COMMUNITY'` in its `with check` clause. This means
an authenticated user can never self-declare their own submission
`VERIFIED` — that directly implements the CLAUDE.md engineering standard
*"No unmoderated write path to provenance-tagged data."* There's no
moderator/admin role modeled yet (nothing in `plan.md`/`TASKS.md` defines
one), so promoting a row from `COMMUNITY` to `VERIFIED` today requires
founder/admin tooling using the Supabase **service-role key**, which
bypasses RLS entirely by design. That's a reasonable v1 answer given there's
effectively one trusted operator (the founder) — but flag it for review once
there's a real moderation workflow (Task 19's human-review queue is the
closest existing precedent).

**Rate limiting is now implemented** (P0-B.4, `migrations/0006_rate_limiting.sql`)
— a `before insert` trigger on `hazard_reports`/`lds_status`/`camera_sources`
counts each user's recent inserts and rejects the request past a cap. See
"Rate limiting on self-service inserts" below for the trigger's shape, its
cap/window, and why a DB trigger was chosen over an application-layer check.
This used to be a `TODO` comment in `0002_rls.sql`; that comment block is
left as-is (migrations aren't rewritten after the fact) rather than edited
to say "done" — this README is the up-to-date summary instead.

## `dive_plans` — private, owner-only, not part of the public provenance model (Task 11.5)

Every other table in this file (`sites`, `hazard_reports`, `lds_status`,
`camera_sources`) is public-read-by-design and carries a `provenance`
column, because they're community map data. `dive_plans` is the opposite
shape on purpose: it's a user's own planned dive (site, date/window,
optional "diving with" label, status), which `plan.md` P0-C already names
as part of v1's real PII surface ("dive-plan location") — so its RLS
(`0007_dive_plans.sql`) is owner-only for every operation, `auth.uid() =
user_id`, with no public-read policy and no `anon` grant at all. There's no
`provenance` column here — provenance answers "who vouches for this
community data," which doesn't apply to a private per-user record nobody
else can read.

`site_id` is nullable — `plan.md`'s minimum-viable definition says "site(s)"
(plural), which a real multi-site plan would need a join table for; that's
out of scope for the "minimum viable" mandate this migration follows. A
single nullable FK is the MVP compromise (see the migration's own header
comment for the full reasoning); Task 11.5's site-detail "add to dive plan"
action always sets it in practice.

`user_id` uses `on delete cascade` (not `set null`, unlike `created_by`/
`reported_by` elsewhere in this file) — a dive plan with no owner isn't a
meaningful row to keep around de-attributed, unlike a community hazard
report other divers might be relying on. Delete is also self-service here
(`dive_plans_delete_own`), unlike the community tables — canceling your own
private plan has no moderation dimension.

## External dive-site sourcing — `sites.external_source`/`external_id` + `external_search_area_cache` (Task 21)

`plan.md` v5 Resolved Decision #6 picks OpenStreetMap/Overpass as the answer
to "`sites` has only 3 founder-seeded rows and no insert path for anyone" —
see `supabase/sources/dive-site-data-source-options.md` for the full
landscape survey and why the two other founder-proposed options (a
commercial RapidAPI dataset, the unlicensed `dulcetgnome/divestop` repo)
were not used. The resulting architecture is on-demand and cache-then-serve,
not a live proxy: local `sites` is always queried and shown first; when a
search radius comes up thin, an Overpass query runs, results land in
`sites` as real rows, and the next person searching that same area gets an
instant local read.

Two schema pieces support this, both Task 21/T21.1/T21.3:

- **`sites.external_source`/`external_id`** (`0008_sites_external_source.sql`)
  — trace an imported row back to its OSM node and guarantee it's never
  imported twice, via a partial unique index. No RLS change: this pipeline
  writes through the service-role client
  (`src/lib/sites/osm-import.ts`'s `upsertSitesFromOsm`), the same
  escape hatch every other automated-write path in this schema already
  uses (`camera_sources` review, `webcam_readings` inserts) — not a new
  self-service policy. Every imported row is stamped `provenance:
  'COMMUNITY'` (never `VERIFIED` — this is unmoderated automated
  ingestion, the same "no unmoderated write path to VERIFIED" standard
  applied everywhere else in this file) and `legal_access_status: null`
  ("not yet assessed" — OSM doesn't reliably carry Florida legal/access
  status, so this is never guessed as `open`). `description` is
  auto-generated to note the OpenStreetMap provenance, satisfying ODbL's
  attribution requirement (see the sourcing doc) at the point a diver
  actually reads the site detail page, not just in a README.
- **`external_search_area_cache`** (`0009_external_search_area_cache.sql`)
  — the per-area cooldown that keeps the on-demand search route
  (`src/app/api/sites/search-nearby/route.ts`) from hammering the public
  Overpass instance, whose fair-use policy is real, not a formality (see
  the sourcing doc's OSM section). **~30 days, not 24h** — corrected
  same-day (see `plan.md`'s "Amended same day" note on Resolved Decision
  #6): dive site locations don't change day-to-day, so a 24h TTL just
  re-hit Overpass for the same area daily for near-certainly identical
  results. Keyed on a coarse ~0.5-degree grid cell, not an exact
  coordinate, so two searches a few hundred feet apart share a cooldown.
  Service-role-only, no public policy at all — this is internal rate-limit
  bookkeeping, not diver-facing map/hazard content.

**ODbL share-alike note, flagged not resolved:** the sourcing doc's
Recommendation section flags that ODbL's share-alike clause "needs a real
legal read before any OSM-derived rows get stored in the app's own
database, not just displayed on a map." Task 21 proceeds on the founder's
own explicit direction to implement the OSM path (`plan.md` Resolved
Decision #6), so this isn't a blocker here — but it's still an open
question worth a real read at some point, not a settled one just because
implementation went ahead.

## `sites.site_type` — map-icon classification (Task 21, T21.5 data-layer half)

`plan.md` v5 Resolved Decision #7 adds a `site_type` axis to `sites` —
`shore_reef`/`shipwreck`/`cave`/`spring`/`artificial_reef`/`unclassified` —
so the map can eventually render a distinct icon per kind of site instead of
just provenance/hazard/legal-access as it does today
(`0010_sites_site_type.sql`). **This is the schema + OSM-tag-derivation half
only.** The map-icon *rendering* half of T21.5, and the pin-legibility
design pass Decision #7 explicitly requires before real icon artwork lands
(the pin already carries 3 visual dimensions and risks becoming unreadable
with a careless 4th — see `creative/AESTHETIC_REVIEW.md`'s process,
referenced from both `plan.md` and `TASKS.md`'s `T21.5` entry), are separate,
in-flight work, not covered here.

`not null default 'unclassified'`, unlike `legal_access_status`'s nullable
"not yet assessed" pattern — `'unclassified'` already *is* the "no known
category" state for this column (the 3 founder-seeded rows, any future
manually-added site with no clear type, and any OSM import whose tags don't
match a known convention), so a separate NULL state would be redundant.

**OSM tag mapping — live-verified against overpass-api.de this pass, not
assumed from tag names alone** (see `src/lib/sites/osm-import.ts`'s
`deriveSiteType` for the derivation code and the fuller research writeup):

- `historic=wreck` → `shipwreck` — confirmed live in Florida (USS
  Vandenberg, USS Spiegel Grove, several named/unnamed FL Keys wrecks, all
  also `sport=scuba_diving`).
- `natural=cave_entrance` → `cave` — confirmed live (Devil's Den, FL).
  Checked *before* `natural=spring`: Devil's Den is colloquially a
  "prehistoric spring" but is tagged `cave_entrance` on OSM itself, not
  `spring` — deriving from the actual tag rather than the venue's common
  name is what keeps this honest.
- `natural=spring` → `spring` — confirmed live, Florida-specific (Ginnie
  Spring, Ichetucknee Spring, Rainbow Spring, Rainbow Spring North, all also
  `sport=scuba_diving`). This is the tag `supabase/sources/dive-site-data-source-options.md`
  section 1's "16 freshwater springs" finding left unverified at the time —
  this pass is that verification.
- `natural=reef` → `shore_reef` — a real, documented, actively-used OSM tag
  (confirmed live in the wider Caribbean/Gulf region).
- `artificial_reef` — **deliberately no derivation case.** `man_made=reef`
  is a real, live OSM tag elsewhere (e.g. Windara Shellfish Restoration
  Reef, Australia; Virginia Dept. of Wildlife Resources' Christmas
  Tree/Tire Reefs), but a global Overpass query for `sport=scuba_diving`
  nodes carrying `man_made=reef` or any `artificial=*` tag returned zero
  results. Nothing in OSM's actual scuba-diving-tagged data distinguishes an
  artificial reef from a natural one today, so this value is reachable only
  via manual/founder curation for now — not derived by the import pipeline,
  and not guessed via a shaky heuristic.
- Anything else → `unclassified` — same "under-classify rather than guess"
  discipline `deriveEntryType` already applies to `entryType`.

## Dive metadata and multi-source provenance (Task 21, T21.21, `0012_sites_dive_metadata.sql`)

`sites` was shaped around one upstream catalogue (`0008`) and around what a
map pin needs (`0010`). Aggregating several catalogues at once —
OpenStreetMap, Florida FWC's artificial-reef program, FWC's Unified Reef Map
habitat polygons — breaks both assumptions. `0012` adds the three things that
were missing. The application modules it persists
(`src/lib/sites/dive-suitability.ts`, `shore-access.ts`, `dedupe.ts`) already
existed and were tested before this migration; the schema was written to
match them, not the other way round.

### Depth is in **feet**, and NULL means "not recorded"

`depth_min_ft` / `depth_max_ft`, both nullable `numeric(5,1)`. Feet is stated
in the column names rather than only in a comment because it's the one unit
mistake here that would be silent and dangerous: a 30 m wreck read as 30 ft
presents a ~100 ft Advanced Open Water dive as an Open Water one. Feet is
also what the source data and the certification limits are both already in
(`OPEN_WATER_MAX_FT` 60 / `ADVANCED_OPEN_WATER_MAX_FT` 100 /
`RECREATIONAL_MAX_FT` 130 in `dive-suitability.ts`), and
`parseDepthRangeFt()` already converts the metric strings some catalogues
ship at the import boundary.

Nullability is load-bearing, not laziness. Most catalogue records genuinely
have no depth, and `classifyDiveSuitability()` deliberately answers "Depth
not recorded — check a local source before planning this dive" rather than
inventing a certification level *or* treating unknown as too-deep (which
would silently hide real shore dives). A `NOT NULL DEFAULT 0` would erase
exactly that distinction and turn "we don't know" into a depth claim a diver
could act on. This is the opposite call from `site_type` (`NOT NULL DEFAULT
'unclassified'`, where an in-band "no known category" value genuinely exists)
and the same call as `legal_access_status`.

`depth_min_ft` is the *shallowest divable* depth, not a bounding-box minimum
— a wreck with its deck at 60 ft and sand at 100 ft stores 60/100, and
suitability is classified on the 60. Two CHECKs: min ≤ max where both are
present, and neither negative.

### Shore access stores the classification *and its evidence*

`shore_access_confidence` is an enum of `likely`/`marginal`/`unlikely`,
matching `ShoreAccessConfidence` in `shore-access.ts` exactly. There is no
`confirmed` value and none should be added: distance to a catalogued entry
point is the only input, while current, surf, visibility, boat traffic, entry
footing and diver fitness all dominate it in practice and none are in this
data. The strongest thing the column may ever say is `likely`.

The enum is named after the TypeScript type rather than after the column
(`shore_access`) — a deliberate departure from `0010`'s same-name convention,
following `provenance_state`/`provenance`'s different-name precedent instead.

Nullable, and the NULL is a third real state: **not yet classified**,
distinct from `unlikely` ("classified, no catalogued entry in range"). Also
worth stating because it constrains rendering: `unlikely` is *also* the
honest answer for a site that is genuinely shore-diveable from an entry
nobody has catalogued yet, so no UI may render it as "boat access only".

`shore_entry_id` (the `ShoreEntryPoint.id` measured from) and
`shore_distance_yards` are stored alongside for two reasons. First, they're
what lets the UI say "295 yd from the 5th Street beach entry" instead of an
unexplained badge — the same "never render a bare signal with no lineage"
standard `plan.md`'s Map-Driven Exploration pillar sets for pins. Second,
they make a future re-classification auditable: both inputs are expected to
change (the entry-point list grows — that's explicitly how coverage grows,
rather than loosening the threshold — and the thresholds themselves have
already been corrected once, from a wrong 0.25 mi to 0.5 mi), and storing
which entry a row was measured from makes "which rows change, and why"
answerable from the data. `shore_entry_id` is text, **not** a foreign key:
the entry points are a hand-curated constant in application code, not a
table. The accepted tradeoff is that a slug can go stale, so a reader that
can't resolve it must fall back to showing the distance alone, never to
inventing an entry name. Distance is in **yards** (the unit the decision is
actually made in) while `classifyShoreAccess()` returns miles — the importer
converts at the write, not every renderer at read.

### `site_sources` — one row per (site, catalogue, upstream id)

`sites.external_source`/`external_id` (`0008`) model exactly one upstream
source. `dedupe.ts` exists because that isn't the reality after aggregation:
its whole premise is that the same physical wreck or reef arrives from
several catalogues under different names with disagreeing coordinates, and a
cluster collapses to one `sites` row derived from N upstream records. An FWC
artificial-reef record merged with an OSM node is one site with two real,
separately-traceable sources.

A join table (not an array column) because each link carries its own
attributes and because uniqueness has to be enforceable. The unique index is
on `(external_source, external_id)` and deliberately **not** on
`(site_id, external_source, external_id)`: one upstream record describes
exactly one physical site, so the same OSM node must never be attached to two
`sites` rows — including `site_id` in the key would permit precisely the
failure deduplication exists to prevent. Both columns are NOT NULL, so unlike
`0008`'s partial index this is a plain unique index that always applies, and
is therefore usable as an ordinary `ON CONFLICT` target (`0008`'s is not —
see its implementation note and `osm-import.ts`'s pre-check workaround).

Column names (`external_source`, `external_id`) and the slug vocabulary are
identical to `0008`/`0009` on purpose: it makes the eventual backfill a
literal column copy rather than a mapping exercise, and keeps one vocabulary
across three tables. `fetched_at` is the only timestamp — on the one write
path that exists (an importer) creation and fetch are the same event, so a
second `created_at` that always equalled it would carry no distinct meaning.

**RLS: public read, service-role-only write — following `0005_webcam_readings.sql`,
not `0009_external_search_area_cache.sql`.** Both of those tables are written
only by automated pipelines, so the choice is about what the table *describes*.
`external_search_area_cache` is internal rate-limit bookkeeping no diver would
ever look at, and gets no policy at all. `site_sources` describes `sites`,
which is public-read, and carries the source attribution the UI must be able
to render — including for the ODbL obligation noted above. Attribution anon
users can't read can't be displayed to them. So: `enable row level security`,
`grant select` to anon/authenticated, one unconditional select policy, and no
insert/update/delete policy at all — writes go through the service-role
client, the same documented "no worker/moderator role modeled yet" gap items
6, 8 and 11 already carry. It is also correctly outside `0006`/`0011`'s
rate-limit trigger: there's no user-attribution column and no self-service
write path to throttle.

### Relationship to `0008`'s columns — redundant, but deliberately not dropped here

`sites.external_source`/`external_id` are now redundant in principle.
`0012` does **not** drop them, because doing so would break working code it
doesn't own: `src/lib/sites/osm-import.ts` writes both on every imported row,
and its duplicate-prevention pre-check queries `sites` by `external_id`
directly, backed by `0008`'s partial unique index. While both exist:

- `site_sources` is authoritative for the full set of sources a site derives
  from.
- `sites.external_source`/`external_id` continue to mean specifically "the
  source this row was originally created from", and must stay consistent with
  the corresponding `site_sources` row — a denormalization of one row of it,
  not an independent claim.

Two sources of truth is a real cost, so it's time-boxed rather than left open
— see Open item #16 for the intended backfill-then-drop sequence.

## Data retention policy (P0-C.2)

Short and forward-looking, matching how little PII v1 actually collects
(`plan.md` P0-C):

- **What v1 retains:** account identity via Google OAuth (`auth.users`,
  managed by Supabase Auth — not duplicated in `profiles` beyond the `id`
  reference), and the community-contributed content itself (`sites`,
  `hazard_reports`, `lds_status` rows, attributed via `created_by` /
  `reported_by`).
- **What v1 does not retain:** emergency contacts, phone numbers, or any
  dive-plan-specific location history — none of that exists in this schema
  or anywhere else in the codebase yet. If/when a feature that tracks
  per-dive location history is actually built, it should not be retained
  longer than necessary for the feature it serves (e.g. tied to an active
  dive plan's lifecycle, not kept indefinitely) — but there's no such
  mechanic to build a real policy against yet, so this is intentionally
  left as a principle to apply later rather than invented machinery for a
  feature that doesn't exist. Revisit this section when dive-plan location
  tracking or emergency contacts (`THREAT_MODEL.md` §11) are actually
  scoped.
- **Account deletion:** deleting a user's `auth.users` row cascades to their
  `profiles` row (`on delete cascade`). `sites` / `hazard_reports` /
  `lds_status` rows they authored use `on delete set null` on the
  `created_by`/`reported_by` FK instead of cascading — their contributed
  content (which other divers may be relying on, e.g. a hazard report)
  survives account deletion but is de-attributed, rather than silently
  disappearing from the map. Flag this for founder review: an alternative
  policy (cascade-delete their `COMMUNITY` contributions too) is defensible
  and may be preferred — this was a judgment call in favor of not deleting
  potentially safety-relevant community data out from under other users.
- **Encryption at rest/in transit:** relies on Supabase's platform
  defaults (Postgres encryption at rest, TLS in transit) — verifying those
  defaults are actually in effect on the real project is P0-C.1, a separate
  checklist item, not something this migration can enforce.

## `camera_sources` — the Phase 3 webcam allowlist (T17.1)

`plan.md`'s Phase 3 sourcing model is explicit: webcam ingestion (Tasks
17–19) is **allowlist/partnership-based, not indiscriminate scraping** —
only sources with explicit permission (municipal open-data feeds, opted-in
dive shops/park services) get ingested. `camera_sources` *is* that allowlist,
as a table: a row is not usable/embeddable by the app in any way until its
`status` reaches `approved`. This is also where Task 19's candidate-discovery
agent is meant to write — its output lands here as `pending_review` and stays
invisible to the public until a human reviews it (`THREAT_MODEL.md` §9:
"never auto-publish a newly discovered camera as a trusted source").

### Status is the gate, not a display label

`status` (`pending_review` / `approved` / `rejected`) is a real access-control
gate, not just a UI label — the RLS policy that grants public read access
filters on `status = 'approved'` directly (see below), so a pending or
rejected row is genuinely unqueryable by anon/regular-authenticated clients,
not just hidden by client-side filtering. Two `check` constraints keep
`reviewed_at`/`reviewed_by` consistent with `status` (both null while
pending, `reviewed_at` populated once a decision is made) so a status flip
can't silently skip stamping who/when reviewed it.

### RLS: public read narrowed to `approved`, self-service capped at `pending_review`

This table's RLS shape departs from `sites`/`hazard_reports`/`lds_status` in
one important way: those are publicly readable regardless of provenance
(`VERIFIED` vs. `COMMUNITY` only changes trust styling, not visibility).
`camera_sources` is not — pending/rejected rows must stay invisible to
regular users, since that's the entire point of a moderation queue. So:

- `camera_sources_select_approved` — anon + authenticated can read rows
  where `status = 'approved'`. This is the only path a normal user has to
  see a camera source.
- `camera_sources_select_own` — a signed-in user can also read their own
  submitted candidates regardless of status. This is a small addition beyond
  the literal "public read = approved only" requirement — seeing your own
  pending/rejected submission isn't a public-visibility leak, it mirrors the
  owner-only read pattern `profiles` already uses. Drop this policy if a
  future moderation-queue UI (T19.2) wants submissions to be reviewer-only.
- `camera_sources_insert_own` — authenticated users can insert a new
  candidate, but `with check (added_by = auth.uid() and status =
  'pending_review')` forces every self-service insert to land as
  `pending_review` — the same self-escalation-prevention shape
  `0002_rls.sql` uses to stop a user from self-declaring `provenance =
  'VERIFIED'`. A normal user can never insert a row that's already
  `approved`.
- **No update or delete policy for authenticated users**, deliberately.
  Approving/rejecting a candidate (flipping `status` and stamping
  `reviewed_at`/`reviewed_by`) is a moderation action, and — same answer
  `0002_rls.sql` gives for promoting `COMMUNITY` → `VERIFIED` — there's no
  moderator role modeled in this schema yet. That path requires the
  Supabase **service-role key** (founder/admin tooling today; eventually
  Task 19.2's moderation-queue UI running with elevated privilege), which
  bypasses RLS entirely. **Flagged for founder review**, same as the
  `sites`/`hazard_reports`/`lds_status` gap above: this is a reasonable v1
  answer with one trusted operator, but revisit once Task 19's actual
  moderation-queue UI is built — that's the natural point to introduce a
  real moderator role instead of relying on the service-role key directly.

### Relationship to the media-embed component's own domain allowlist (Task 20)

`src/components/media-embed` (T20.1–T20.3) has its own, separate,
code-level domain allowlist for iframe-embedded third-party players
(`EMBED_DOMAIN_ALLOWLIST` in `src/components/media-embed/allowlist.ts`).
The two allowlists serve different layers and are **deliberately kept
separate, not wired together**: `camera_sources.status = 'approved'` gates
which *camera sources* the app is allowed to treat as trusted at all; the
media-embed component's allowlist gates which *embed-player hostnames* are
safe to render inside a sandboxed iframe at the rendering layer,
independent of where the URL came from.

**Decided (T20.2 follow-up):** the embed allowlist stays static and
hand-curated rather than derived from approved `camera_sources.source_url`
hostnames. Two reasons: (1) `EMBED_DOMAIN_ALLOWLIST` is checked
synchronously in the media-embed component's render path — client-side —
specifically so a disallowed iframe is never mounted even transiently;
deriving it from a live Supabase read would make that check asynchronous
and regress that property. (2) `camera_sources.source_url` has no format/
domain validation at the DB level (see this table's column comment below),
so `status = 'approved'` only means "a human approved this as a real
camera source," not "this hostname is safe to iframe as third-party
content" — auto-deriving the embed allowlist from any approved row would
let a moderation mistake on the first axis silently become a security
regression on the second.

Instead, the gap where the two lists could quietly drift apart (an
approved `camera_sources` row whose `source_url` needs an
`EMBED_DOMAIN_ALLOWLIST` entry that was never added) is closed by
**detection, not automation**:
`src/lib/camera-sources/embed-allowlist-consistency.ts` exports a pure
`findEmbedAllowlistDrift()` function plus a Supabase-backed
`checkApprovedCameraSourcesEmbedAllowlist()` wrapper that flags any
approved, embeddable-player-shaped `camera_sources.source_url` whose
hostname isn't on the static allowlist. It's callable via
`src/app/api/admin/embed-allowlist-consistency/route.ts` (`CRON_SECRET`-
gated GET/POST, mirroring the webcam-extraction cron route's
manual-trigger-alongside-scheduled-trigger shape, since nothing on the web
guarantees background execution). A drift result is always surfaced for a
human to resolve (add the hostname to the static allowlist, or re-review
the `camera_sources` row) — the check never resolves drift on its own.

### `source_url` uniqueness

`camera_sources` has a unique index on `source_url` — a duplicate-candidate
guard so Task 19's discovery agent (or repeat manual submissions) can't
flood the moderation queue with the same URL over and over. If a legitimate
need for re-adding the same URL under a new row ever comes up (e.g.
resubmitting a previously rejected source), that's a judgment call for
whoever builds T19.3.

## `offline-bundles` — the Task 12 offline bundle asset bucket (T12.1)

`plan.md`'s "Intent-Driven Offline Cache" pillar pre-bundles site telemetry,
hazard maps, and imagery ~24h before a dive window so a site works with zero
cellular coverage. `offline-bundles` is the Supabase Storage bucket those
bundle files (JSON telemetry, hazard-map/site images) live in, once a real
bundle-preparation server flow exists. This migration creates the bucket and
its RLS only — the actual "generate a bundle, sign its manifest, upload it
here" flow is still `T12.1`-dependent future work (no live Supabase project
exists yet); `src/lib/offline/bundle-signing.ts` and `bundle-verification.ts`
already implement the signing/verification logic that flow will call.

### Public read, service-role-only write

Same shape as `camera_sources`' service-role-only approve/reject gate above,
applied to a Storage bucket instead of a table:

- The bucket is created with `public = true` and carries an explicit
  `offline_bundles_select_public` RLS policy on `storage.objects` (scoped to
  `bucket_id = 'offline-bundles'`) granting `anon`/`authenticated` read.
  Bundle assets are the same trust tier as the rest of this app's public
  map/hazard data (`sites`/`hazard_reports`/`lds_status` are also publicly
  readable with no login wall) — once a bundle's checksums and HMAC
  signature verify client-side (`bundle-verification.ts`), there's no
  reason to gate reading the underlying files. Public read is a *read*
  concern only; it does not weaken the tamper-detection story, which lives
  entirely in the signing/verification logic, not in access control.
- **No insert/update/delete policy for `anon`/`authenticated` at all.**
  There is no moderator/uploader role modeled anywhere else in this schema
  (same gap `camera_sources` and `sites`/`hazard_reports`/`lds_status`
  document above), so the only way to write into this bucket is the
  Supabase **service-role key**, which bypasses RLS entirely — used by the
  future bundle-preparation route once a live project + real upload flow
  exist. **Flagged for founder review**, same as the other service-role-only
  write gaps in this file: reasonable for v1's single-trusted-operator
  reality, revisit if/when a broader contributor/moderation model is built.

### Why no `storage.objects`-level `grant`/`enable row level security`

`0002_rls.sql`'s rationale ("state every grant explicitly, even where a
platform default might cover it") applies to tables this project owns in the
`public` schema. `storage.objects` is a Supabase-platform-managed system
table that already ships with RLS enabled and its own base grants to
`anon`/`authenticated`/`service_role` — re-issuing those isn't the
documented customization surface for Storage and could fail without
table-owner privileges. `0004_offline_bundles_storage.sql` only adds
bucket-scoped RLS policies, which is the supported way to customize Storage
access per bucket.

### `file_size_limit` / `allowed_mime_types` — judgment call

Not specified in `plan.md`/`TASKS.md` beyond "site telemetry, hazard maps,
and visual assets." The migration caps objects at 20 MiB and allowlists
`application/json`, common image types (`jpeg`/`png`/`webp`/`svg+xml`), and
`application/pdf` for hazard-map documents. Revisit both once a real bundle
is actually produced and its size/format profile is known — this is a
starting guess, not a spec.

## `webcam_readings` — Task 18's `MODEL_INFERRED` visibility/chop estimates (T18.3)

The table this file's own "Why `MODEL_INFERRED` isn't in the
`provenance_state` enum" section above said Task 18 would eventually need. A
scheduled worker (`src/app/api/cron/webcam-extraction/route.ts`, T18.2)
estimates water visibility and chop/sea-state from an **already-approved**
`camera_sources` snapshot using a Claude vision model
(`src/lib/webcam-extraction/model.ts`, T18.1), and every result lands here
tagged `MODEL_INFERRED` with a mandatory confidence score, the exact model
identifier, and both a capture and insert timestamp — rendered only via
`src/components/webcam-readings/reading-badge.tsx` (T18.4), which wraps the
existing `ProvenanceBadge` rather than reinventing it.

### Same service-role-only write shape as `camera_sources` and `offline-bundles`

Public read (`using (true)`), no insert/update/delete policy for
`anon`/`authenticated` at all — the scheduled worker writes exclusively via
the service-role client (`src/lib/supabase/admin.ts`), the same "no
moderator/worker role modeled, service-role required" gap items 6 and 8
above already document. A row existing here at all implies its source
camera was already `approved` (T17.1's gate), so this table's own RLS
doesn't need to re-check that — the trust boundary already happened one
table over.

### The real cost decision this schema enables, but doesn't make

Unlike the free-tier infra this project otherwise runs on, the vision-model
calls that populate this table are **real, metered Anthropic API spend from
the first request on** — there is no free tier. `src/lib/webcam-extraction/
model.ts` and `rate-cap.ts` both document this at length: the worker
no-ops unless `WEBCAM_EXTRACTION_ENABLED=true` is explicitly set (a
deliberate founder-confirmation gate, not implied by merging this code or
by an `ANTHROPIC_API_KEY` existing in the environment), and even once
enabled, a hard daily call cap (`DAILY_CALL_CAP`, currently 20) bounds the
worst case. See item 10 below.

## Rate limiting on self-service inserts (P0-B.4, `0006_rate_limiting.sql`)

`0002_rls.sql`'s header comment flagged this gap from the start: RLS can
express *who* can write which rows, but Postgres RLS has no concept of
throttling *how often* — a signed-in user could submit unlimited
`hazard_reports`/`lds_status` rows. That comment sketched two options and
recommended a Postgres trigger (its option (b)) as "enforced no matter which
client calls the API." `THREAT_MODEL.md` §1 calls for exactly this
("rate-limit and require reputation/history before a user's hazard report
can flip a site's public status"), scoped there as Phase 2+ hardening rather
than a P0 blocker — but with a real (if `localStorage`-backed today)
submission UI now built (`src/components/lds/lds-submission-form.tsx`,
T16.3), the TODO's own "needed before real community submission UI ships"
condition is close enough to be worth closing now rather than later.

### The trigger

`public.enforce_submission_rate_limit()` is a single reusable `plpgsql`
trigger function, attached `before insert` to three tables via `create
trigger ... execute procedure enforce_submission_rate_limit(user_column,
window_minutes, max_rows)`. On each insert it counts the submitting user's
(`auth.uid()`, read off the row's own attribution column) rows created in
the last `window_minutes` minutes — the exact query shape `0002_rls.sql`'s
comment already sketched
(`select count(*) from <table> where <user_column> = auth.uid() and
created_at > now() - interval '<N> minutes'`) — and raises an exception if
that count is already at or past `max_rows`. It is deliberately **not**
`security definer`: unlike `handle_new_user()` in `0001_init.sql` (which
needs elevated privilege to write `profiles` before the inviting session has
any grant on it), this trigger runs inside the normal RLS-enforced insert
path, reading only tables the inserting authenticated user can already
`SELECT` from.

### Where it's attached, and where it deliberately isn't

Attached to all four self-service-insertable tables: `hazard_reports`
(`reported_by`), `lds_status` (`created_by`), `camera_sources` (`added_by`)
— the first three in `0006_rate_limiting.sql` — and `sites` (`created_by`),
added later in `0011_sites_rate_limit.sql` (T21.16).

`camera_sources` went beyond `0002_rls.sql`'s literal TODO as a judgment call
documented in 0006's header: `camera_sources_insert_own`
(`0003_camera_sources.sql`) has the exact same self-service-insert-capped-at-
a-non-privileged-status shape as the other two, so it carries the same abuse
exposure, and the trigger function being generic made covering it a one-line
addition rather than new logic.

**`sites` was originally left out and has since been added** — 0006 scoped it
out because it wasn't in `0002_rls.sql`'s TODO and "has no live self-service
submission UI yet." That reasoning aged out: `sites_insert_own`
(`0002_rls.sql`) already grants every authenticated user `insert` on `sites`
(capped at `COMMUNITY` provenance, but uncapped in *volume*), and "no UI
exists" was never an access-control argument in an architecture where the
Supabase client SDK is called directly from a signed-in browser session with
no server route in between. `sites` is also the one table here designed to
grow continuously and unattended (Task 21's OSM import) and the table every
map pin reads from. `0011` closes that with a single `create trigger` call
reusing the same `('created_by', 10, 5)` arguments.

Still **not** attached to `camera_sources`' approve/reject transition — that
path is already service-role-only, so there's no user-facing write to
rate-limit there.

### What the `sites` trigger covers, and why the OSM import path is correctly outside it

Worth spelling out, because `sites` is the only table here with two live
write paths carrying different identities:

- **Covered — self-service.** A signed-in user inserting through the
  anon-key client. `sites_insert_own`'s `with check (created_by =
  auth.uid() ...)` guarantees a real, non-null submitter on this path, so
  the trigger counts and caps it exactly like the other three tables.
- **Not covered — the OSM import** (`upsertSitesFromOsm`,
  `src/lib/sites/osm-import.ts`). That pipeline writes through the
  **service-role** client specifically to bypass RLS, and its row builder
  never populates `created_by` — imported rows are attributed to
  OpenStreetMap via `external_source`/`external_id` (`0008`), not to a user.

The important detail is *how* the function behaves on that second path.
`enforce_submission_rate_limit()` does **not** call `auth.uid()`; it reads
the submitter off the row (`to_jsonb(NEW) ->> user_column`) and
short-circuits with `return new` when that's NULL — a documented fail-open
branch ("this is an anti-abuse control, not a safety-critical one"). So for
service-role writes the trigger is a silent **no-op**: it does not raise, it
does not count against a NULL uuid, and it **cannot break the import**.
Attaching it to `sites` was safe for that specific reason, not by luck.

That the automated path is uncovered is correct rather than a hole, because
it's already bounded by two independent limits upstream of the insert
(T21.13): an external search now requires a signed-in user
(`src/app/api/sites/search-nearby/route.ts`, failing closed to "anonymous"
if the auth check itself throws), and `DAILY_EXTERNAL_SEARCH_CAP = 100` is a
global rolling-24h ceiling across all users and cells
(`src/lib/sites/external-search-cache.ts`), on top of `0009`'s per-cell
~30-day cooldown. A per-user row-count trigger adds nothing there — there is
no per-user attribution on an imported row to count — while a variant that
*did* reject NULL-attribution inserts would break a working, already-bounded
pipeline.

`0011` also adds `sites_created_by_created_at_idx`, a **partial** index
(`where created_by is not null`) supporting the trigger's count query. 0006
added no such index for its three tables, which was fine for small
human-write-only tables; `sites` grows continuously, so the count would
otherwise become a sequential scan on every insert — including every
imported row, which would pay the scan only to hit the fail-open branch.
Partial because the trigger only ever counts non-null submitters, so the
imported bulk (the part that actually grows) stays out of the index — the
same technique `0008`'s `sites_external_source_id_idx` already uses on this
table.

### Cap and window: 5 inserts per 10 minutes, per user, per table

(Applies uniformly to all four tables — `0011` deliberately reused `0006`'s
numbers for `sites` rather than inventing a fourth, differently-tuned one,
since there's still no real site-submission traffic to tune against.)

Not specified anywhere in `plan.md`/`TASKS.md` — the only signal is urgency
("before real community submission UI ships"), not a target number. This is
a judgment call, documented rather than left ambiguous:

- **10-minute window** matches `0002_rls.sql`'s own sketch verbatim, so it's
  not a new number invented here.
- **5 rows per window per table** is meant to be generous enough for a
  genuine burst of legitimate activity (logging conditions at several sites
  in one outing; correcting a submission right after making it) while still
  bounding a buggy or scripted client to a low double-digit row count per
  hour rather than unbounded.

Applied uniformly across all three tables rather than guessing a different
number per table with no usage data to justify the difference — cap/window
are passed as trigger arguments per table, so splitting them apart later is
a one-line change, not a rewrite. **Flagged for founder review**, same as
this file's other judgment calls: revisit both numbers once real
community-submission traffic exists and either looks wrong in practice
(too tight for honest use, or still too loose against real abuse).

### Why a DB trigger over an application-layer check

`0002_rls.sql`'s TODO named both options; this migration builds option (b)
because it's enforced inside Postgres itself, independent of which code path
performs the insert. This app's actual write path today is the Supabase
client SDK called directly from a signed-in browser session — there is no
server-side API route standing between the client and the database for
these tables — which is exactly the case an application-layer rate limit
protects weakest against (it only guards the one route it's added to, and a
direct-from-Supabase-client architecture doesn't have "a route" in the way
a traditional backend does). A trigger holds regardless of whether the
insert comes from the real app, a future server action, a one-off script,
or the Supabase SQL editor used by a signed-in low-trust client.

## Open items / judgment calls for founder review

1. **`lds_status` append-only vs. update-in-place** (see above) — pick one
   before Task 16 writes real queries against it.
2. **Rate limiting is now implemented** (`0006_rate_limiting.sql` +
   `0011_sites_rate_limit.sql`, see "Rate limiting on self-service inserts"
   above) — the cap (5 rows/10 min/table) is a judgment call with no real
   traffic data behind it yet. Scope is now all four self-service-insertable
   tables (`hazard_reports`/`lds_status`/`camera_sources`/`sites`); the
   OSM import path is deliberately outside it and separately bounded (T21.13)
   — see the "What the `sites` trigger covers" section above. Revisit the
   cap/window once real community-submission usage exists.
3. **`created_by`/`reported_by` on delete: `set null`, not `cascade`** —
   confirm this is the intended data-retention tradeoff (content survives
   account deletion, de-attributed) rather than deleting the user's
   contributions.
4. **`handle_new_user()` trigger auto-creates `profiles` rows** — this goes
   slightly beyond "just the schema" (it's a small piece of DB-side
   behavior) but was included because it's the standard, safe Supabase
   pattern for "populated on first sign-in" and touches nothing under
   `src/`. If the auth flow being built for P0-A.4/P0-A.5 wants to handle
   profile creation in app code instead, this trigger can be dropped or
   left as a harmless no-op safety net (it's idempotent via `on conflict
   (id) do nothing`).
5. **`dive_plans` now exists (`0007_dive_plans.sql`), not yet applied to a
   live project** — schema portion of P0-C's "dive-plan location" PII
   surface is written; the retention-policy prose above still describes it
   at the principle level rather than naming a concrete lifecycle rule
   (e.g. auto-archive N days after `planned_date`) — revisit once real
   usage exists to know if that's actually needed, same reasoning as item 2.
6. **`camera_sources` approve/reject is service-role-only, same as the
   `VERIFIED` promotion gap above** — no moderator role exists yet. T19.2's
   moderation-queue UI (`src/app/moderation/camera-sources`) and its
   approval route (`src/app/api/camera-sources/[id]/review/route.ts`) are
   now built and gate on "is signed in," not "is a moderator" — both files
   say so explicitly. Revisit by introducing a real role instead of relying
   on the service-role key directly.
7. **`camera_sources`'s embed allowlist is intentionally not wired to the
   media-embed component's allowlist** — decided, not deferred; see the
   "Relationship to the media-embed component's own domain allowlist"
   section above. The consistency-check gap that decision leaves open is
   closed by `src/lib/camera-sources/embed-allowlist-consistency.ts` /
   `src/app/api/admin/embed-allowlist-consistency/route.ts`, not by wiring
   the two allowlists together.
8. **`offline-bundles` write access is service-role-only, same gap as #6** —
   no uploader/moderator role exists yet. Revisit once a real
   bundle-preparation server flow is built (`T12.1`-dependent).
9. **`offline-bundles`' `file_size_limit`/`allowed_mime_types` are a
   starting guess** — see the "judgment call" note above. Confirm/adjust
   once a real bundle's size and format profile is known.
10. **Turning on real webcam-extraction API spend
    (`WEBCAM_EXTRACTION_ENABLED=true`) is an explicit founder-confirmation
    item** — the Anthropic API has no free tier, in real tension with this
    project's no-budget/free-tier constraint. Nothing in this codebase
    enables it on its own; see `src/lib/webcam-extraction/model.ts`'s header
    comment for the full writeup before flipping it on.
11. **`webcam_readings` write access is service-role-only, same gap as #6
    and #8** — no worker/moderator role exists yet. The scheduled worker
    (`src/app/api/cron/webcam-extraction/route.ts`) is the first real code
    path (not just a documented gap) that exercises this.
12. **OSM/Overpass data's ODbL share-alike clause has not had a real legal
    read** — flagged, not resolved, in the "External dive-site sourcing"
    section above. Task 21 proceeded under the founder's own explicit
    direction to implement the OSM path (`plan.md` Resolved Decision #6),
    but whether storing OSM-derived rows inside `sites` (not just displaying
    them) triggers an obligation to license that portion of the database
    under ODbL itself is still an open question worth a real answer, not a
    settled one.
13. **`0011_sites_rate_limit.sql` has NOT been applied yet — founder action.**
    Unlike a code change, a migration only takes effect once it's run against
    the live project. Every migration in this directory is applied manually
    via the Supabase SQL editor (Option B above); `0011` was written and
    reviewed but not run, since no DB credentials exist in the development
    environment. Until it's applied, `sites` still has **no insert throttle
    at all** on the `sites_insert_own` path. Apply it after `0006` (it
    depends on `enforce_submission_rate_limit()` already existing) — a
    smoke test is to insert 6 `sites` rows as one signed-in user inside 10
    minutes and confirm the 6th raises, then confirm an OSM import still
    succeeds (it should, via the NULL-`created_by` fail-open branch).
14. **`external_search_area_cache`'s ~0.5-degree grid-cell size is a
    judgment call** (the ~30-day cooldown window itself is now a specified
    number, not a judgment call — see `plan.md`'s same-day amendment to
    Resolved Decision #6), not specified anywhere beyond "coarse, not
    exact-coordinate" (Task 21/T21.3). No real search-traffic data exists
    yet to tune the cell size against. Revisit once real usage shows it's
    too coarse (missing genuinely distinct areas) or too fine (still
    re-triggering Overpass calls for what's practically the same search).
15. **`0012_sites_dive_metadata.sql` has NOT been applied yet — founder
    action.** Same status and same reason as #13: every migration here is
    applied manually via the Supabase SQL editor (Option B above), and no DB
    credentials exist in the development environment, so `0012` was written
    and reviewed but not run. Until it's applied, `sites` has no depth or
    shore-access columns and `site_sources` does not exist — so
    `src/lib/sites/queries.ts`'s reads, which now name those columns
    explicitly, will fail loudly against an un-migrated project rather than
    silently returning partial rows (that loudness is the point of the
    explicit column lists — see that file's `SITE_DETAIL_COLUMNS` comment).
    Apply any time after `0001_init.sql`. Smoke test: insert a site with
    `depth_min_ft = 90, depth_max_ft = 30` and confirm
    `sites_depth_min_le_max` rejects it; insert two `site_sources` rows with
    the same `(external_source, external_id)` pointing at different sites and
    confirm the unique index rejects the second; confirm an anon client can
    `select` from `site_sources` but not `insert`.
16. **`sites.external_source`/`external_id` (`0008`) are now redundant with
    `site_sources`, deliberately kept, and scheduled for removal** — see
    "Relationship to `0008`'s columns" above for why `0012` doesn't drop
    them. The intended end state, in order: (1) backfill
    `insert into site_sources (site_id, external_source, external_id, fetched_at)
    select id, external_source, external_id, updated_at from sites where
    external_source is not null and external_id is not null on conflict do
    nothing` — `updated_at` is an acknowledged approximation of "when this
    was last fetched" for rows imported before `site_sources` existed, and
    deserves a comment on the backfill rather than a silent `now()`;
    (2) repoint `osm-import.ts`'s duplicate pre-check at `site_sources`;
    (3) drop `sites_external_source_id_idx`, then the two columns. Step 2 is
    application code owned elsewhere, which is why this isn't one batch.
    Until then, treat `site_sources` as authoritative and `0008`'s columns as
    a denormalization of it.
17. **The new derived `sites` columns are self-service-writable, same as
    `name`/`description`.** `sites_insert_own` (`0002_rls.sql`) lets any
    signed-in user insert a `sites` row capped at `provenance = 'COMMUNITY'`,
    and that now includes self-declaring `depth_min_ft`/`depth_max_ft`/
    `shore_access` — columns that are *supposed* to be derived by
    `dive-suitability.ts`/`shore-access.ts` and that feed a diver's go/no-go
    read. Not a new hole (`description` was already equally load-bearing and
    equally self-declarable) and contained by the same COMMUNITY cap, but it
    does mean a derived-looking value on a COMMUNITY row isn't necessarily
    derived, and no UI should present it as if the classifier produced it.
    The honest fix is a moderation/derivation distinction this schema has no
    role model for yet — the same gap as items 6/8/11 — not a column-level
    policy. Flagged rather than papered over.
