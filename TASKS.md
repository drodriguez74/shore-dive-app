# Task Tracker — Shore-Diving Intelligence & Discovery Platform

Decomposed, checkable breakdown of `plan.md` (Hardened Spec v4) for progress tracking. This file is the "how, in granular steps"; `plan.md` is the "what and why" — each item below traces back to a task/decision there so nobody has to re-derive the reasoning.

**Status markers:** `[ ]` not started · `[x]` done · `[~]` in progress · `[!]` blocked (reason noted inline).

**Convention, added 2026-08-08 after a five-lens adversarial review of `plan.md` found this being applied inconsistently:** `[x]` requires the feature to be reachable via a real navigation path in the live app — a disclosed demo route (`/post-dive`, `/media-demo`) is `[~]` at best; a component that's built but mounted by zero routes (no demo, no real page — worse than either) is `[~]` or `[ ]`, never `[x]`, regardless of how complete the underlying code is. See `plan.md` v5's Engineering Standards addenda for the incident that prompted this.

**Traceability convention:** `(→ Task N)` / `(→ P0-X)` points to `plan.md`; `(→ §N)` points to a `THREAT_MODEL.md` finding. IDs (e.g. `P0-A.2`, `T15.4`) are stable — reference them in commits/PRs.

Update checkboxes as work lands. Don't let this drift from reality — if a task's scope changes, update `plan.md` first, then reflect it here.

---

## Open items at a glance

- `[ ]` `P0-B.6` — Seed initial site data (founder-curated — content task, not engineering, since there's no community yet) … _(archive)_
- `[~]` `T34` — **Review recommendations, 2026-11-11** — status and remaining items are in `HANDOFF.md`'s 2026-11-11 (later) section … _(archive)_
- `[~]` `T31` — **Deploy-config fixes + AI-discovery flow bug triage, 2026-09-05 (founder live-testing the Vercel sandbox).** First session with real deployed-app + … _(archive)_
- `[ ]` `T15.8` — Manually test on iOS Safari (installed-PWA and not) — document actual observed reliability, feed back into disclaimer copy if it's worse than assumed … _(archive)_
- `[~]` `T17.2` — Ingestion connector for the first personally-negotiated camera source(s) — **partially done 2026-08-08.** The founder personally named real starting … _(archive)_
- `[~]` `T19.1` — Candidate-discovery workflow (LLM-assisted, constrained to allowlist candidates only) — **scaffold only, by explicit founder decision**, per … _(archive)_

Finished items below are one line each; the full narrative for anything marked _(archive)_ is in `TASKS_ARCHIVE.md`.

---

## Phase -1: Scaffolding — done this session

- [x] `S.1` Next.js (App Router) + TypeScript + Tailwind scaffolded, builds and lints clean
- [x] `S.2` Serwist PWA layer configured (service worker + `manifest.ts`); `dev`/`build` forced to webpack (Turbopack unsupported by Serwist)
- [x] `S.3` Supabase client helper created (`src/lib/supabase.ts`) — not yet pointed at a real project
- [x] `S.4` Mapbox map component created (`src/components/site-map.tsx`) — degrades gracefully without a token, not yet pointed at a real token
- [x] `S.5` Stray home-directory npm/node_modules cruft removed (was corrupting installs)

## Phase 0: Foundational Prerequisites (→ blocks Phase 1)

### P0-A: Identity & Auth (→ P0-A)
- [x] `P0-A.1` Create Supabase project; add URL/anon key to `.env.local` and Vercel env vars *(founder action — external account)* … _(archive)_
- [x] `P0-A.2` Configure Google OAuth provider in Supabase Auth (free — Google Cloud OAuth client) … _(archive)_
- ~~`P0-A.3` Configure Apple Sign In provider~~ — **dropped for v1** (founder decision): requires a paid Apple Developer Program membership ($99/yr) with no free path, conflicts with no-budget context … _(archive)_
- [x] `P0-A.4` Build sign-in UI + OAuth callback route (Google only) — `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`. Confirmed working end-to-end live 2026-08-08 (real Google OAuth redirect, real `client_id`) … _(archive)_
- [x] `P0-A.5` Session handling / auth guard for protected routes — `src/proxy.ts` handles session-cookie refresh (the "session handling" half) … _(archive)_
- [x] `P0-A.6` Create `profiles` table, populated on first sign-in — schema/trigger side in `supabase/migrations/0001_init.sql` (`handle_new_user()`), app-code side in `src/lib/supabase/profile.ts`'s `ensureProfile()` (called … _(archive)_

### P0-B: Data Provenance Model (→ P0-B, → §1, → §8)
- [x] `P0-B.1` Design `sites` schema: coordinates, description, `VERIFIED`/`COMMUNITY` tag, legal/access-status field, created_by, timestamps — `supabase/migrations/0001_init.sql` … _(archive)_
- [x] `P0-B.2` Design `hazard_reports` schema with provenance tag + timestamp — same migration
- [x] `P0-B.3` Design `lds_status` (fill station) schema with provenance tag + last-verified timestamp — same migration; modeled as an append-only log (mirrors `hazard_reports`), not update-in-place — confirm this fits when Task 16 is built
- [x] `P0-B.4` Row-level security: public read, authenticated write, rate-limited community submissions — `supabase/migrations/0002_rls.sql` … _(archive)_
- [x] `P0-B.5` Provenance-tier visual styling (map pins, status badges) — `src/components/provenance-badge.tsx`; also supports `MODEL_INFERRED` (styled now, unused until Task 18)
- [ ] `P0-B.6` Seed initial site data (founder-curated — content task, not engineering, since there's no community yet) — starter example in `supabase/seed.sql` (3 real sites incl. La Jolla Cove), real curation still a founder task

### P0-C: PII Handling (→ P0-C, → §11)
- [x] `P0-C.1` Verify Supabase encryption-at-rest defaults and enforce HTTPS/TLS everywhere … _(archive)_
- [x] `P0-C.2` Write a minimal data-retention policy (what gets deleted, when) and implement it — documented in `supabase/README.md`
- [x] `P0-C.3` RLS confirms profile/location data is readable only by its owner — `supabase/migrations/0002_rls.sql`'s `profiles_select_own`/`profiles_update_own` policies (`auth.uid() = id`) already satisfy this for everything … _(archive)_

## Phase 1: Core Telemetry & Offline Resilience

### Task 11.5: Dive Plan creation & Site Detail (→ plan.md v5 Priority Triage #1/#3/#5, new — blocks real completion of 12/14/16)
- [x] `T11.5.1` Real `sites`/`hazard_reports` query layer — `src/lib/sites/queries.ts` (`listSitesWithHazardFlag`, `getSiteWithHazards`), `src/lib/sites/types.ts`, `src/lib/sites/logger.ts` … _(archive)_
- [x] `T11.5.2` Real map pins wired into `src/components/site-map.tsx` (`siteMarkers` prop, defaults to `[]`) and `src/app/page.tsx` (real server-side fetch + a plain "Dive sites" list fallback that works with or without a Mapbox … _(archive)_
- [x] `T11.5.3` Site detail route — `src/app/sites/[id]/page.tsx`. Public read (no auth wall on site/hazard data, matching `sites`' RLS), server-side `getUser()` check only gating the "add to dive plan" section … _(archive)_
- [x] `T11.5.4` `LegalAccessBadge` — `src/components/legal-access-badge.tsx`. Renders all 5 states of `legal_access_status` including `null` ("not yet assessed," reuses the dashed-border grammar), built icon-for-icon from the … _(archive)_
- [x] `T11.5.5` Minimum-viable `dive_plans` table — `supabase/migrations/0007_dive_plans.sql` (Resolved Decision 5's exact field list: site, planned date/window, optional "diving with" label, status) … _(archive)_
- [x] `T11.5.6` "Add to dive plan" action — `src/app/sites/[id]/add-to-dive-plan-form.tsx` (client form) + `src/app/api/dive-plans/route.ts` (API route, `user_id` always taken from the authenticated session, never the request … _(archive)_
- [x] `T11.5.7` Wires the already-built-but-unreachable `PrefetchButton`/`PretripChecklist` (Task 12) into the site detail page — closes `T12.6`/`T12.7`'s "mounted by zero routes" downgrade.
- [x] `T11.5.8` **Location-aware map + nearby-sites list**, added 2026-08-08 after the founder noticed the homepage always centered on California regardless of where they actually were … _(archive)_
- `T11.5.9` **Real dive-site content beyond the 3 CA seed rows — surfaced, not yet actioned.** Investigating the Florida-defaulting question surfaced a bigger gap: there is currently no way for *anyone* — founder or community … _(archive)_

**Verified 2026-08-08**, independently of the implementing agent's self-report (same rigor as every other change this session): read every new/changed file … _(archive)_

**Known follow-ups, explicitly scoped out of this pass, not silently dropped:**
- `PretripChecklist` on the site detail page still runs on its default mock plan, not a real query joined to `dive_plans` — a meaningfully bigger "your whole plan" cross-site view than this page's single-site scope; natural next step now that `dive_plans` exists.
- Tide-station link (Optional/Bonus bucket) and the pin-tap "compact preview bottom sheet" (`creative/flows/map-exploration.md` nice-to-have) were not built — a direct link from the map pin to the site detail page covers this pass's scope.
- `T14.1`'s stubbed `DivePlanCheckInState` edge is not yet wired to the real `dive_plans` table (only the Safe-Return `running → checked-in` edge is real) — separate follow-up.

### Task 12: Intent-Driven Prefetch Pipeline (→ Task 12, → §2)
- [x] `T12.1` Supabase Storage bucket for offline bundle assets — `supabase/migrations/0004_offline_bundles_storage.sql`: creates the `offline-bundles` bucket (public read, 20MiB/object cap, JSON/image/PDF allowlist) + RLS on … _(archive)_
- [x] `T12.2` Server-side bundle signing/checksumming (manifest + hash) — `src/lib/offline/bundle-signing.ts`, HMAC-SHA256 via `node:crypto` over a canonicalized manifest, `timingSafeEqual` comparison … _(archive)_
- [x] `T12.3` **Decision:** Dexie.js confirmed as the IndexedDB wrapper (installed)
- [x] `T12.4` Client-side IndexedDB schema for cached site/hazard records — `src/lib/db.ts` (`cachedSites`/`cachedHazards`, both with a `cachedAt` timestamp)
- [x] `T12.5` Service worker runtime-caching strategy for site assets (extends Serwist config) — `src/app/sw.ts`, `StaleWhileRevalidate` for Mapbox tiles + site imagery, ahead of the default cache rules
- [x] `T12.6` "Prefetch Now" manual trigger UI — `src/components/prefetch-button.tsx`. **Real as of 2026-11-11 (`T32`)** — fetches, verifies, and saves the site's actual bundle; the placeholder described next is gone … _(archive)_
- [x] `T12.7` Pre-trip checklist prompt — `src/components/pretrip-checklist.tsx`. **Re-upgraded to `[x]` 2026-08-08:** mounted for real on the site detail page (`T11.5`) … _(archive)_
- [x] `T12.8` Client-side bundle integrity verification — fail closed on a bad check — `src/lib/offline/bundle-verification.ts`. **Real today:** per-file SHA-256 checksum verification via `crypto.subtle.digest` … _(archive)_

- [x] `T32` **Offline prefetch made real end-to-end, 2026-11-11.** Closes the gap `T12.6`/`T12.8` documented as "honest stub": the button cached a placeholder and `/api/verify-bundle` didn't exist.
  - `GET /api/sites/[id]/offline-bundle` (`src/lib/offline/site-bundle.ts`): site + hazard reports as one checksummed, HMAC-signed bundle; account ids stripped; 503 `not_configured` when `BUNDLE_SIGNING_SECRET` is unset (never serves unsigned). Bundles are built on demand — the `offline-bundles` Storage bucket (`T12.1`) is still unused and is only needed once bundles carry images.
  - `POST /api/verify-bundle`: server-side signature check; anything but a confirmed match is `valid: false`.
  - `src/lib/offline/prefetch-site.ts`: fetch → verify → save to `db.cachedSites`, typed failure reasons, nothing written unless verification passed; refuses below 5 MB free storage; requests persistent storage.
  - `PrefetchButton` shows real freshness (`FreshnessBadge`) and a specific message per failure; adding a site to a dive plan triggers the same save and reports the outcome (the "intent-driven" trigger).
  - `/offline` (+ homepage link): saved sites rendered fully from IndexedDB; service worker `fallbacks` serves it for any failed navigation.
  - Verified: 28 new tests; in a real browser against a production build — save, stop the server, navigate to `/dive-plans` → saved-sites page rendered with the site's full detail. The browser run used a local stand-in for Supabase (the project was paused at the time); the endpoints were then re-checked against the real project — see `HANDOFF.md`.
  - **Not done:** automatic refresh ~24h before a dive (no reliable web background execution — the pre-trip checklist is the manual path); images/map tiles in bundles; iOS Safari real-device check (same founder action as `T15.8`).
  - **Founder action:** set `BUNDLE_SIGNING_SECRET` in `.env.local` and Vercel, or Prefetch reports "isn't set up on this server yet".
- [x] `T33` **Maintenance, 2026-11-11.** Next.js 16.3.0 → 16.4.6 (critical advisory GHSA-p293-qw3h-jr36) + `npm audit fix` … _(archive)_

- [~] `T34` **Review recommendations, 2026-11-11** — status and remaining items are in `HANDOFF.md`'s 2026-11-11 (later) section. Done: moderator allowlist (`MODERATOR_EMAILS`), CI + keep-alive workflows, `/api/health`, security headers, error-text sanitising, rate limit on the offline endpoints, auth round-trip skip for anonymous visitors, homepage streaming, Safe-Return UI tests, opt-in dive-log backup (`0017_dive_logs.sql`, **not yet applied live**), saved-site auto-refresh, dead-code removal, webcam workers on `claude-haiku-5-5`. Open: comment trim, `dive-site-explorer.tsx` split, privacy-policy draft.

### Task 13: Offline Sync Status UI (→ Task 13, → §2)
- [x] `T13.1` "Cached as of [time]" freshness indicator component — `src/components/freshness-badge.tsx`, live-updating (re-renders every 60s so fresh→stale is visible without a reload)
- [x] `T13.2` Staleness threshold logic (e.g. flag past 12h) — configurable prop on `FreshnessBadge`, defaults to 12h; missing/invalid `cachedAt` fails toward "stale," not "fresh"
- [x] `T13.3` Wire freshness indicator into site detail + map pin UI — homepage (`src/app/page.tsx`) still shows the `FreshnessBadge`+`ProvenanceBadge` pairing on mock cached-site entries (T13.3's original scope, unchanged), and … _(archive)_

### Task 21: External Dive-Site Data Sourcing (→ Task 21, → plan.md Resolved Decision #6, new 2026-08-08, founder-directed)
Implements the founder's own framing ("if searching a new location with no data, use the API") via OpenStreetMap/Overpass … _(archive)_
- [x] `T21.1` Migration `supabase/migrations/0008_sites_external_source.sql` — nullable `external_source text`/`external_id text` on `sites`, **partial** unique index on `(external_source, external_id)` where both non-null … _(archive)_
- [x] `T21.2` `src/lib/sites/osm-import.ts` — `queryOverpassNearby`/`upsertSitesFromOsm` built to the pre-agreed exact signatures, reconciled against `T21.4`'s already-landed `nearby-dive-sites-list.tsx` (confirmed its … _(archive)_

**Bug #1 found and fixed live, 2026-08-09 — filter too strict:** the founder searched from Fort Lauderdale post-migration and found `sites` still only had the 3 original CA rows, despite the UI reporting an external search happened … _(archive)_

**Bug #2 found and fixed live, same day — the real cause of every "406"/"504" seen all session was neither rate-limiting nor an IP block, it was a missing `User-Agent` header.** Live testing after Bug #1's fix kept hitting non-ok responses even with generous … _(archive)_

**Real South Florida data live-populated same day**, via a one-off script (not part of the app) that calls the real, unmodified production `queryOverpassNearby`/`upsertSitesFromOsm` functions across 6 overlapping points spanning Key West → West Palm Beach … _(archive)_
- [x] `T21.3` `src/app/api/sites/search-nearby/route.ts` — local-first via `listSitesWithHazardFlag()` + `sortByDistanceWithinRadius` … _(archive)_
- [x] `T21.4` `src/components/nearby-dive-sites-list.tsx` now calls `GET /api/sites/search-nearby` once geolocation resolves to real coordinates, for any finite radius (re-fetches when the radius `<select>` changes) … _(archive)_

**Explicitly not in this pass** (see plan.md's Blocked bucket): the RapidAPI commercial option (pricing unconfirmed — founder action to check), `dulcetgnome/divestop` (no license — needs author permission), and `cetra3/divedb`'s data-reuse question (AGPL code not used; whether its *data* is separately reusable is unresolved, not urgent).

**Added 2026-08-08, same day — plan-only, implementation explicitly NOT authorized yet** (founder: "No dev work needs to be done until I say it... this is for updating our plan"). Do not start T21.5/T21.6 without an explicit go-ahead, distinct from the "fan out and implement" authorization T21.1–T21.4 already had.

**Hold lifted for T21.5/T21.6/T21.7, same day (2026-08-08), founder's own words, quoted in order:** after the note above was written, the founder asked (verbatim) to update the plan for Mapbox's recommended GeoJSON-source/symbol-layer pattern at scale ("For … _(archive)_
- [x] `T21.5` Site-type classification (`site_type` enum: `shore_reef`/`shipwreck`/`cave`/`spring`/`artificial_reef`/`unclassified`) + distinct map-pin icons per type (plan.md Resolved Decision #7) … _(archive)_
- [x] `T21.6` Map and `NearbyDiveSitesList` share one radius-driven data source (plan.md Resolved Decision #8) … _(archive)_
- [x] `T21.7` Migrated site-pin rendering in `src/components/site-map.tsx` from one React `<Marker>` per site to a GeoJSON `Source` + symbol `Layer` (plan.md Resolved Decision #9), using react-map-gl's declarative … _(archive)_

**Independent verification, 2026-08-08, same day (not the implementing agents' own reports):** read every new/changed file for T21.1–T21.7 in full; `tsc --noEmit`/lint/150-test-suite/`npm run build` all clean from a fresh shell … _(archive)_

**Regression found live, then resolved same day:** before migrations were applied, `site_type` being added to `listSitesWithHazardFlag`/`getSiteWithHazards` (the *core* site-listing queries, not just new Task 21 paths) meant the homepage's map and list went … _(archive)_

**Full live re-verification after migrations landed, 2026-08-08 (a genuinely fresh dev server — a stale process on port 3000 from earlier testing was found and killed first, to avoid trusting a pre-migration connection):**
- Homepage correctly renders all 3 real sites again, map and list both — the regression is gone.
- Map pin click, at real pixel precision (`agent-browser mouse move`/`down`/`up`, not the imprecise `click` selector … _(archive)_
- Site-type icon rendering: a cropped/upscaled screenshot of a live pin shows the "unclassified" glyph (a plain white circle, correctly composited into the existing teardrop body with its provenance-pattern ring and the amber MPA corner badge) actually present and legible under inspection — not just claimed from source reading.
- The real Overpass search pipeline: a Fort Lauderdale search (thin local data) was confirmed via server log to have actually fired a real external search (`search_nearby`/cache-claim trace), and the UI correctly showed "Checked … _(archive)_
- Map/list radius sync (`T21.6`'s actual fix): selecting "All" radius while centered on Fort Lauderdale (zero nearby real sites) was confirmed, via the map's own visually-hidden accessible site list (`sr-only <ul>`, fed by the … _(archive)_

Nothing about this batch remains unverified except the icon system's real-world glance-legibility at true pin size, which is explicitly a design-review question (`creative/AESTHETIC_REVIEW.md`), not a functionality gap — flagged honestly rather than asserted as settled.

### v5.3 batch, 2026-08-09 — real South Florida data + filter-by-type

- [x] `T21.8` **OSM description enrichment** ("this should include all data") — `OsmDiveSite` gained `osmDescription`/`depth`/`website`, extracted from the OSM node's own real tags (`normalizeElement`) … _(archive)_
- [x] `T21.9` **Filter dive sites by type** ("we can have tags in the dive sites and be able to filter by tag") — built on the existing `site_type` column, no new migration … _(archive)_
- [x] `T21.10` **Root-caused and fixed the real reason every Overpass call was failing** — not rate-limiting or an IP block (the working theory during live debugging), but Overpass's Apache front-end 406-rejecting requests with … _(archive)_
- [x] `T21.11` **Bulk-populated real South Florida coverage, Key West → West Palm Beach** — the on-demand route only ever populates where a real user has searched … _(archive)_

- [x] `T21.12` **Bounded site queries — fixed a real silent-truncation bug, not a perf nit** (`src/lib/sites/queries.ts` only) … _(archive)_

**Full live re-verification after all of the above, same day:** fresh dev server (killed a stale process still lingering from earlier testing first — confirmed via `lsof`, not assumed), Fort Lauderdale geolocation patched via `agent-browser` … _(archive)_

- [x] `T21.13` **Closed a real, verified hole: `GET /api/sites/search-nearby` was a public, unauthenticated trigger for service-role writes.** Below the 3-local-result threshold the route called Overpass and imported new `sites` … _(archive)_

- [x] `T21.14` **Wired the two hardening changes together** (the integration `T21.12`/`T21.13` were each deliberately forbidden from doing, since both would otherwise have edited `search-nearby/route.ts` concurrently … _(archive)_

- [x] `T21.18` **Exploration state now survives navigation** — three symptoms the founder reported (2026-08-09), all one root cause: the homepage always opened on the hardcoded California fallback and then visibly jumped to the … _(archive)_
- [x] `T21.15` **Closed the repo's highest-risk coverage gap: the Safe-Return timer had zero tests.** `CLAUDE.md` names it one of two life-safety-critical areas, yet all 202 pre-existing tests covered pure helpers only … _(archive)_
- [x] `T21.16` **Closed the last two defense-in-depth gaps this review batch left open** — one DB-side, one in `getSiteWithHazards()` … _(archive)_

- [x] `T21.17` **Extracted the map pin icon system out of `site-map.tsx` into `src/lib/sites/pin-icons.ts`** … _(archive)_

- [x] `T21.19` **Fixed the false-alarm-on-load bug `T21.15` found and pinned — founder call made: reset to idle, and say so.** A persisted `status: "running"` with `startedAt: null` passed `readPersisted()`'s validation (it … _(archive)_

- [x] `T21.20` **Replaced reef-band input with cross-shore transect sampling — the banding logic was right, the input was wrong** (`src/lib/sites/reef-bands.ts`, `reef-bands.test.ts`, new `src/lib/sites/urm-client.ts` + test) … _(archive)_

- [x] `T21.21` **Schema for multi-catalogue aggregation — depth, shore access, and multi-source provenance** (`supabase/migrations/0012_sites_dive_metadata.sql`, `supabase/README.md`, `src/lib/sites/types.ts`, `queries.ts` … _(archive)_
- [x] `T21.22` **Site detail page enriched for the diver the founder actually described** ("I want to know of all dive sites as I may end up on a boat charter going there. Or specifically target one that does") … _(archive)_
- [x] `T21.23` **Dive difficulty rating — beginner/intermediate/advanced/technical, composed from what already existed** (`src/lib/sites/dive-difficulty.ts` + test, wired into `site-dive-profile.tsx` as a new "Dive difficulty" … _(archive)_
- [x] `T21.24` **Depth-aware reef-band splitting — solves the Datura Ave "Known Limitation" `reef-bands.ts` left open at T21.20, via a new NOAA bathymetry client** (new `src/lib/sites/bathymetry-client.ts` + test, additive … _(archive)_
- [x] `T21.26` **Dive difficulty usable while browsing, not just on the site detail page — filter chip row + list badge** (`src/lib/sites/explorer-preferences.ts` + test, `src/components/dive-site-explorer.tsx` … _(archive)_
- [x] `T21.27` **Pin-tap preview sheet, and removed dev-scaffolding from the production homepage** … _(archive)_
- [x] `T21.25` **Reef bands → candidate `sites` rows, dry-run only — the schema-shaping half of the reef-band pipeline** (`src/lib/sites/reef-band-sites.ts` + test) … _(archive)_
- [x] `T21.33` **Full-catalogue shore-access audit — 2 real missing entries found, 5 sites reclassified, most flagged "gaps" were false positives** (`src/lib/sites/shore-access.ts`, `shore-access.test.ts`) … _(archive)_
- [x] `T21.34` **Second real misclassification found by the founder, root cause was a mis-located entry coordinate, not a missing entry** (`src/lib/sites/shore-access.ts`, `shore-access.test.ts`) … _(archive)_
- [x] `T21.35` **Entry-point ground-truthing sweep + new `SHORE_ACCESS_EXCEPTIONS` mechanism, after the founder lost confidence in the data ("I'm now really doubting the integrity of the dive site information")** … _(archive)_
- [x] `T21.36` **Fourth real misclassification found — a genuine coverage gap between two existing Dania-area entries, "Erojacks Dania" ("the Dania Jacks")** (`src/lib/sites/shore-access.ts`, `shore-access.test.ts`) … _(archive)_
- [x] `T21.37` **Systematic deep-research sweep of the full 445-site catalogue, founder-directed ("we really need to dig deep and research using google search in ai mode and read the responses") after 4 straight real bugs found** … _(archive)_
- [x] `T21.38` **U-LINK hybrid breakwater units — evidence tier upgraded from inferred to directly confirmed.** Founder found divenavigator.com's dedicated listing, which states plainly "Entry Type: Boat & Shore," ~750 ft (231 m) … _(archive)_
- [x] `T22.1` **Schema for researched site-description enrichment** (`supabase/migrations/0013_sites_research_summary.sql`) … _(archive)_
- [x] `T22.2` **Types + query layer** (`src/lib/sites/types.ts`, `src/lib/sites/queries.ts`, `queries.test.ts`). New `ResearchSource` type … _(archive)_
- [x] `T22.3` **`SiteResearchSummary` UI** (`src/components/site-research-summary.tsx`, `.test.tsx`, wired into `src/app/sites/[id]/page.tsx` after "About this site") … _(archive)_
- [x] `T22.4` **The research-and-write pass for the 38 shore-accessible sites (21 coastal + 17 springs/caves).** Research is done and reviewed … _(archive)_
- [x] `T22.5` **Fixed a real, pre-existing bug found while verifying T22.4's spring corrections**: `site-dive-profile.tsx` called `classifyShoreAccess()` (a coastal-distance model) unconditionally, including for springs/caves … _(archive)_
- [x] `T22.6` **Removed hardcoded mock dive-shop/dive-plan data that was rendering live, founder-directed audit** ("do we have hardcoded dive sites anywhere in our code or is everything pulled from db") … _(archive)_
- [x] `T23.1` **Global shore-access classification, Part A — the app's shore-access model was silently Florida-only everywhere.** Founder (2026-08-10): "I may dive outside of Florida … _(archive)_
- [x] `T23.2` **Threaded the OSM entry tag into the live import pipeline** (`osm-import.ts`). `toInsertableRow()` never set `shore_access` at all before this — not for any site, including Florida … _(archive)_
- [x] `T23.3` **Converged every render-time consumer onto the stored classification instead of live-recomputing.** Real founder-visible bug: `site-dive-profile.tsx`, `dive-difficulty.ts`, and `site-location-map.tsx` all called … _(archive)_
- [x] `T23.4` **Backfill, resolved 2026-08-10 once `0014` was applied — turned out to need no script at all.** All 445 live rows already had a real `shore_access` value (set by whatever process originally populated the catalogue … _(archive)_
- [x] `T23.5` **Founder-reported live bug: map pins vanished and the shore-access filter showed zero results, even though the catalogue genuinely has real sites.** Traced through the whole stack, not guessed at … _(archive)_

  1. **`/api/sites/search-nearby` genuinely fails on larger local-query responses** — reproduced consistently in both `next dev` and a production build (390 rows succeeds, ~400+ rows fails), while the *identical* Supabase query … _(archive)_
  2. **The client-side bug that actually explains the reported symptom**: the route's own contract already reserved its `error` field for exactly this kind of local-database failure, returning `{ sites: [], error: "<message>" }` … _(archive)_

  **Also fixed while in this code**: the route computed `truncated` (from `listSitesInBounds`) but never included it in the response body — a real gap that became more likely to matter now that a dense-area search routinely hits the new 200-row cap … _(archive)_

  Also restarted the dev server cleanly (it had been running many hours across dozens of file edits this session) and applied `cache: "no-store"` to the Supabase server client's fetch (Supabase's own documented Next.js SSR recommendation, since App Router patches global `fetch`) — neither turned out to be the actual root cause, but both are correct, defensible changes independent of this bug, kept rather than reverted.

  **9 new tests** across `dive-site-explorer.test.ts` (`nextSearchStateFromResponse`'s error/success/truncated branches) and `nearby-dive-sites-list.test.tsx` (the truncation note's visibility). Verified live end-to-end against a real production build across radii 25/100/250/500 mi: zero errors, correct `truncated` reporting at every radius that actually hits the cap. `tsc --noEmit`, lint, **668 passing**, `npm run build` all clean.

- [x] `T25` **Five-persona UX audit + the "immediate" fix list, 2026-08-13.** Founder: "we need to really look at the UX Design itself … _(archive)_
  1. **Removed a leaked task-tracker reference from user-facing copy** — the homepage subhead literally read "...LDS/fill-station pins (Task 16)..." Rewritten in plain language, and the homepage now also links to the new dive-plans page when signed in.
  2. **Built the missing dive-plan list view** (`src/app/dive-plans/page.tsx`, `src/lib/dive-plans/{queries,format}.ts`) — `AddToDivePlanForm` has always been able to CREATE a `dive_plans` row … _(archive)_
  3. **Fixed a safety-relevant false claim**: "Prefetch Now" → "Cached for offline use" was caching a placeholder payload, not real site data, on an app whose own core pillar promises usability with zero cellular coverage … _(archive)_

  `tsc --noEmit`, lint, **721 passing**, `npm run build` clean throughout. Remaining audit findings, triaged into `plan.md`'s v5.5 addition (2026-08-13) rather than left only as a paragraph here … _(archive)_
- [x] `T28` **Real-app/mockup parity pass, 2026-08-13 — the founder's own read: "under mockups we have real design and html pages.. We don't have not even 20% of those pages created** … _(archive)_
  1. **Onboarding, 0/7 mockup screens real → built.** New `src/lib/onboarding/preferences.ts` (`useHasSeenWelcome`, the same `useSyncExternalStore` module-cache + cross-tab `storage`-event pattern `explorer-preferences.ts` … _(archive)_
  2. **`PretripChecklist` (built since `T12.7`, live since `T25`) was still being fed `[]` on every real page** … _(archive)_
  3. **Local Dive Shop status had no dedicated page — only a small map-pin popup buried among dive-site pins.** New `/fill-stations` route (`src/app/fill-stations/page.tsx`, `src/components/lds/fill-stations-list.tsx`), matched … _(archive)_
  4. **Map-exploration + site-detail flow restyled onto the approved depth-scale tokens** (`--depth-0`…`--depth-3`, `--depth-border`) already wired into `globals.css` … _(archive)_
  5. **Offline-prefetch + post-dive-prompt + LDS-submission surfaces swept onto the same tokens** … _(archive)_
  6. **Real functional gap found and deliberately NOT built this pass, flagged instead of silently skipped**: "Frictionless Voice Logging" (a named product pillar) has no real audio-capture/STT component anywhere in `src/` … _(archive)_
  7. **Real mockup/spec mismatch found and deliberately NOT built, flagged instead**: `creative/mockups/lds-moderation/03-moderation-pending.html`, `04-moderation-security-notice.html`, `05-moderation-recently-decided.html` … _(archive)_

  `tsc --noEmit`, lint, **739 passing** (up from 721), `npm run build` all clean throughout every step. `CREATIVE_BACKLOG.md` updated in the same pass to reflect which flows are real vs. still mockup-only.
- [x] `T26` **Give Safe-Return a real homepage presence + a PWA install nudge, 2026-08-14.** From `T25`'s UX audit: the single most safety-relevant feature in the app was reachable from the homepage only via one unexplained text … _(archive)_

  **Two more real bugs found during this same live-testing pass, unrelated to `T26` itself, fixed in passing:**
  1. **`welcome-gate.tsx`'s layout only worked at the mockup's exact assumed phone height.** The source mockup (`01-welcome.html`) was authored at a fixed `min-height: 844px` with a `flex: 1` spacer forcing the CTA buttons to the … _(archive)_
  2. **A leaked internal `TODO:` string in the post-dive prompt's user-facing copy** ("Saved on this device only for now — not yet synced to an account. TODO: migrate to Supabase once dive logs have a real backend.") … _(archive)_
- [x] `T27` **A "use my current location" shortcut into the map-pan discovery flow, 2026-08-14.** From `T25`'s UX audit, tour-guide persona: a guide or shop owner standing at a real site already knows exactly where they are … _(archive)_
- [x] `T29` **Three-agent fan-out round, 2026-08-20/21 — founder: "Lets work on the next highest value add tasks** … _(archive)_

  **A real reconciliation complication, worth recording as a pattern**: this session's own uncommitted work (onboarding, `/fill-stations`, `/dive-plans`, the T26/T27 homepage-card and locate-button work, the depth-token restyle sweep) had never been committed … _(archive)_

  1. **Task 16's "LDS status reports currently claim to reach other divers but are localStorage-only, reaching no one"** … _(archive)_

  2. **"Frictionless Voice Logging" — a named product pillar, zero prior implementation — built end-to-end and mounted at `/post-dive`.** New `src/lib/voice-logging/` (pure, unit-tested: STT feature-detection, a 7-state/11-event … _(archive)_

     **A real, deliberate deviation from the approved mockup, flagged rather than silently shipped**: mockup 02 claims voice is "transcribed on this device — nothing is uploaded." That is not reliably true … _(archive)_

     A second deliberate scope-narrowing: mockup 04's Notes field implies generative summarization (a sentence appearing nowhere in the literal transcript) … _(archive)_

  3. **A NOAA tide-station link-out on the site detail page** (`plan.md` Optional/Bonus: "near-zero cost, free NOAA data") … _(archive)_

  `tsc --noEmit`, lint, **936 passing** (up from 747), `npm run build` all clean on the fully-merged tree, all three items live-verified against the running dev server after merging, not just before. Worktrees and their branches cleaned up after merge.
- [x] `T30` **Four-agent fan-out round, 2026-08-21 — founder: "Read the UX audit findings from the current context and perform: task breakdown, execution (fan out sub-agents), verification & summary."** Compiled … _(archive)_

  1. **Safe-Return disclaimer: DAN reference + buddy solo-only clarification** (`plan.md`'s "Safety first" v5 addendum, both previously-unaddressed items) … _(archive)_
  2. **Admin-route `noindex` hardening + LDS liability disclosure.** `/moderation/camera-sources` and `/webcam-discovery` (Resolved Decision #4's known gate-on-"signed-in"-not-"moderator" issue) now export `{ robots: { index` … _(archive)_
  3. **Hazard-report recency/staleness weighting** (`plan.md`'s Task 13 v5 addition: "a 3-week-old minor report and a 2-hour-old dangerous one render identically") … _(archive)_
  4. **Voice-log structured fields: tank pressure, buddy name, water temp, exposure suit** (`plan.md`'s v5 field-list correction to the pillar `T29` had just shipped). All four wired end-to-end … _(archive)_

  `tsc --noEmit`, lint, **1023 passing** (up from 936), `npm run build` all clean on the fully-merged tree. All four items live-verified against a running dev server after merging. Worktrees and branches cleaned up after merge. `UX_AUDIT_CHECKLIST.md`, `TASKS.md`, and `plan.md` updated together in one pass at the end, per this repo's established "update the tracker once, after the whole round lands" rule.
- [x] `T24` **Map-pan dive-site discovery: "Fetch dive sites here" + a free-tier AI-assisted web-search fallback, both shipped 2026-08-11** (`/Users/darwinrodriguez/.claude/plans/curious-shimmying-curry.md`) … _(archive)_

  **Phase 1 — reuses the existing free OSM/Overpass pipeline, zero new schema.** `SiteMap` gained a persistent "Fetch dive sites here" button (`onFetchHere`/`isFetchingHere` props) reading the map's live center imperatively via `mapRef.current?.getCenter()` … _(archive)_

  **Phase 2 — AI-assisted fallback, only offered as a second explicit action once Phase 1 genuinely finds zero results.** Original design assumed a Claude API worker with the `web_search` tool, matching every other AI-backed worker in this codebase … _(archive)_

  New `src/lib/site-discovery/` module: `reverse-geocode.ts` (Mapbox reverse geocoding, reuses the existing `NEXT_PUBLIC_MAPBOX_TOKEN`, no new vendor … _(archive)_

  **No moderation queue — the founder's explicit, deliberate call.** "If we did [a moderation queue] the end user would need to wait for admin approval. This is a bad experience … _(archive)_

  **Scope deliberately kept simple at first** ("this simple agent," per the founder): Gemini initially read only Brave's search-result titles/snippets/URLs, not full page content.

  **Live-tested end-to-end same day, once real keys were provisioned — two real bugs and one real design gap found and fixed, not just a clean pass:**
  1. **Hardcoded model ID 404'd for a newly-provisioned key.** `gemini-2.5-flash` (still listed by Google's own `/models` endpoint) returned "no longer available to new users" against a fresh free-tier key. Switched to the **`gemini-flash-latest` alias**, which tracks whatever Google currently routes new keys to, rather than a version number that can go stale silently.
  2. **Real candidate quality confirmed, but every candidate came back with `latitude`/`longitude: null`.** Against La Romana, DR (nothing in the local catalogue there), the pipeline found 6 real, correctly-named Bayahibe-area … _(archive)_
  3. **Built a coordinate follow-up pass** (`enrichMissingCoordinates` in `area-research.ts`): one targeted Brave search per candidate still missing coordinates (`"{name}" {placeName} coordinates GPS`), throttled 1.1s apart after … _(archive)_
  4. **Founder-directed fix**: added `page-fetch.ts` — fetches the actual page (not just the snippet) of the top follow-up result per candidate, strips it to plain text (regex-based, no new dependency), and hands that to a second … _(archive)_

  **Cost/latency tradeoff worth flagging**: the coordinate-enrichment pass adds real wall-clock time — up to ~6 candidates × (1.1s throttle + Brave request + up to an 8s page-fetch timeout), observed **~35-40s** in testing. Already gated behind an explicit "Search the web" click with its own loading state, but worth the founder's attention if it feels too slow in practice — `COORDINATE_ENRICHMENT_LIMIT` (currently 6) is the one-line lever to shorten it.

  **27 new tests** (`rate-cap.test.ts` mirroring `webcam-extraction`'s exactly, `gemini-client.test.ts`'s `normalizeCandidate` defensive-parsing coverage, `page-fetch.test.ts`'s `extractReadableText` HTML-stripping coverage, `dive-site-explorer.test.ts`'s manual-location wording branches). `tsc --noEmit`, lint, **699 passing**, `npm run build` all clean throughout every round of this.

  **Third live-testing round, same day — a real hallucination-adjacent bug found and fixed, then a real recall gap found and fixed:**
  1. **Founder-reported (Naples/Cape Coral, FL): the pipeline returned 4 candidates, and every single one was wrong.** "Venice Beach" — a real, correctly-described Florida site … _(archive)_
  2. **That same proximity fix immediately over-corrected for small places.** Founder: "I just fetched from Bermuda and it says 50 miles … _(archive)_
  3. **Founder, after seeing only 1 real candidate for Bermuda against an independently-sourced list of a dozen+: "I need to be able to discover these details by fetching** … _(archive)_
  4. **Cost/latency now higher, worth the founder's attention**: the discovery pass's 4 parallel page fetches plus the coordinate pass's up-to-6 sequential fetches pushed a full "Search the web" run to **~50s** in testing … _(archive)_

  **5 new tests** (`area-research.test.ts`). `tsc --noEmit`, lint, **704 passing**, `npm run build` clean after every round.

  5. **Founder: "Top sites in Bermuda may not include shore dives. I want both top sites and shore dives."** Correct … _(archive)_
  6. **Founder, using the real live UI, not a test script: "I just did the search around Bermuda and again nothing came back** … _(archive)_
- [~] `T31` **Deploy-config fixes + AI-discovery flow bug triage, 2026-09-05 (founder live-testing the Vercel sandbox).** First session with real deployed-app + Vercel-log access (`vercel login` in-session, project linked). Founder is now testing in two environments — local `localhost:3000` and the online sandbox `https://shore-dive-app.vercel.app`.

  **Fixed / resolved:**
  1. **Google sign-in redirected to `localhost:3000` after the OAuth handshake on the deployed app.** Not an app-code bug … _(archive)_
  2. **`GEMINI_API_KEY` missing from Vercel production** — AI map-pan discovery half-worked (Brave retrieved, Gemini extraction threw `GEMINI_API_KEY is not set`). Vercel log at 16:36Z confirmed it … _(archive)_

  **"Add to map" / discovery-flow bugs from founder live-testing (see `plan.md` items 22–26):**
  3. ~~**Added sites don't survive navigation.**~~ **Fixed 2026-09-05.** `POST /api/sites/candidates/add` *does* write a real permanent `sites` row (verified in logs: `candidates_add.inserted name:"Theo's Wreck" siteId:1e35e3b2-…` … _(archive)_
  4. ~~**Search appears broken until a hard refresh after browser-Back.**~~ **Fixed 2026-09-05.** bfcache restore doesn't remount, so the search effect never re-ran and its aborted in-flight fetch was never retried. Added a `pageshow`/`event.persisted` listener that bumps a nonce in the search effect's deps → one clean re-fetch.
  5. ~~**200-site truncation in dense areas** (`plan.md` item 24).~~ **Fixed 2026-09-05 (later)** … _(archive)_
  6. ~~**"Add to map" disabled for candidates with no coordinates — a dead end** (`plan.md` item 25).~~ **Fixed 2026-09-06.** `site-discovery-candidates.tsx`: a no-coords candidate now shows a "Look up '<name>' on Google Maps" … _(archive)_
  7. **Shore-access UI near-silent outside South Florida.** *(open — product judgement, not a clear bug)* Detail page already says "Shore access not assessed — a gap in our data, not evidence the site is boat-only" … _(archive)_
  8. ~~**"Add to map" refreshed the discovered list and blocked adding a second candidate** (`plan.md` item 27).~~ **Fixed 2026-09-05 (later), rolled into item 10 below.** `handleCandidateAdded` merges the added candidate into `search.sites` for an instant pin, which flipped the `search.sites.length === 0` gate that rendered the whole web-search panel — so the first add unmounted the panel.
  9. ~~**An added site's map pin wasn't clickable / wouldn't open the detail page** (`plan.md` item 28).~~ **Fixed 2026-09-05 (later).** `POST /api/sites/candidates/add` built its response marker from the row PostgREST echoes … _(archive)_
  10. ~~**No way back to the web-search list after adding one site or reloading** (`plan.md` item 29).~~ **Fixed 2026-09-05 (later), founder decision** … _(archive)_

  **Decisions made this session:**
  - **Voice-transcription privacy copy (`plan.md` item 20): pinned until prod-ready.** Still POC, no live app — the shipped honest-disclosure copy (`on-device`/`browser-service`/`unknown`, failing pessimistic) stays as the safe default; a real copy review waits. Not a blocker. Recorded in `plan.md` item 20 + `UX_AUDIT_CHECKLIST.md` Blocked section.
  - **T24–T30 committed as one unit** (`7edb90d`) rather than retro-split into per-task commits — the work was deeply interleaved in an uncommitted working tree and splitting cleanly would have been error-prone. Branch `feature/task-22-research-summary` pushed; PR not yet opened (no `gh` CLI locally — compare URL handed to founder, PR body drafted).
  - **OAuth URL config is dashboard-only, not repo config** — affirmed the app code stays deployment-agnostic; environment differences live entirely in the Supabase + Google Cloud dashboards, documented in `supabase/README.md`.

  `tsc --noEmit`, lint, **1047 tests passing** (items 5 & 6 both merged to `main` 2026-09-06), `npm run build` all clean. Item 7 (`plan.md` 26) is the only one left — a founder judgement call.
- [x] `T21.32` **Shore-entry line on the site map — a dashed line from the shore to the site, for shore-accessible sites only** (`src/components/site-location-map.tsx` + its test) … _(archive)_
- [x] `T21.31` **Shore-access filter — the app's own core premise had no filter for it** (`src/lib/sites/explorer-preferences.ts`, `src/components/dive-site-explorer.tsx`, `src/components/nearby-dive-sites-list.tsx` + tests) … _(archive)_
- [x] `T21.30` **Filter buttons went unresponsive after repeated clicking — root cause was two structurally-different render trees for the same controls, not a filter-logic bug** (`src/components/nearby-dive-sites-list.tsx`, new … _(archive)_
- [x] `T21.28` **Reef-band import completed and written live — 14 real `shore_reef` sites, using measured NOAA depth over the literature fallback** (`src/lib/sites/reef-band-sites.ts` updated, live write via a scratch runner) … _(archive)_
- [x] `T21.29` **Map went silently blank right after load — fixed by giving the map the same empty-state honesty the list already had** (`src/components/dive-site-explorer.tsx`, `src/components/nearby-dive-sites-list.tsx` … _(archive)_

## Phase 2: Community Data & Automated Monitoring

### Task 14: Post-Dive Micro-Prompt Engine (→ Task 14)
- [x] `T14.1` Define "active dive-plan check-in state" trigger logic (not bare GPS proximity) — `src/hooks/use-post-dive-prompt-trigger.ts` … _(archive)_
- [x] `T14.2` Single-tap condition-logging prompt UI — `src/components/post-dive-prompt/` (visibility/current/marine-life chips, one-tap dismiss, localStorage persistence with a TODO for the pending Supabase migration) … _(archive)_
- [x] `T14.3` Settings toggle to disable inference-based triggers — `src/hooks/use-post-dive-prompt-settings.ts` (same `useSyncExternalStore` localStorage pattern as the Safe-Return timer) … _(archive)_

### Task 15: Safe-Return Emergency Timer (→ Task 15, → §0.1 resolution — life-safety-critical, extra rigor)
- [x] `T15.1` Countdown timer UI (start/duration selection) — `src/app/safe-return/page.tsx` + `src/components/safe-return/`
- [x] `T15.2` Notification API integration for expiry alert — `src/lib/safe-return/alert-channel.ts` (`LocalAlarmChannel`)
- [x] `T15.3` Web Audio alarm sound — same file, two-tone siren pattern, loops until `stop()`
- [x] `T15.4` Vibration API integration where supported — same file, guarded (`navigator.vibrate` checked before use, absent on iOS Safari by design)
- [x] `T15.5` Explicit-confirmation check-in (not a passive dismiss)
- [x] `T15.6` Onboarding disclaimer screen — states plainly it only alerts on this device, doesn't notify anyone else, and is less reliable when backgrounded/locked, especially on iPhone
- [x] `T15.7` Persist timer state across reloads — `src/hooks/use-safe-return-timer.ts`, localStorage-backed, modeled as a `useSyncExternalStore` external store (not an effect+setState hydration flag … _(archive)_
- [ ] `T15.8` Manually test on iOS Safari (installed-PWA and not) — document actual observed reliability, feed back into disclaimer copy if it's worse than assumed — **still needs a physical device, founder action**
- [x] `T15.9` Abstract the alert-channel interface so a future Web Push/SMS channel can be added without a rewrite — `AlertChannel` interface in `alert-channel.ts`, `LocalAlarmChannel` is v1's only implementation

**Note:** the agent building this feature hit two dropped connections mid-session; the final two lint errors (`react-hooks/set-state-in-effect` in the timer hook and the status panel) were finished by hand rather than via a third agent retry — both fixed with the same `useSyncExternalStore` approach the agent had already correctly identified before it was interrupted. Full project build/lint verified clean afterward with all four workstreams merged together.

### Task 16: Local Dive Shop (LDS) Logistics Layer (→ Task 16)
- [x] `T16.1` Map integration showing fill-station pins from `lds_status` (P0-B.3) — `src/components/site-map.tsx` now accepts `ldsMarkers` (defaults to mock data), status-colored dots + popup with `ProvenanceBadge` … _(archive)_
- [x] `T16.2` "Last verified" timestamp UI (reuse T13.1's freshness component) — `src/components/lds/last-verified-badge.tsx`, thin wrapper reusing `FreshnessBadge` unmodified (not forked)
- [x] `T16.3` Community submission form for LDS status updates (routes through P0-B.4's moderated write path) — `src/components/lds/lds-submission-form.tsx` … _(archive)_

## Phase 3: Visual & Webcam Intelligence

**Sourcing model applies to all of Tasks 17–19 (→ Phase 3 sourcing model, → §9): allowlist/partnership only, never scraping.**

### Task 17: Live Camera API / Stream Ingestion (→ Task 17)
- [x] `T17.1` `camera_sources` allowlist schema — `supabase/migrations/0003_camera_sources.sql`. `pending_review`/`approved`/`rejected` status is the access gate … _(archive)_
- [~] `T17.2` Ingestion connector for the first personally-negotiated camera source(s) — **partially done 2026-08-08.** The founder personally named real starting sources (YouTube-hosted beach cams from `visitlauderdale.com`'s official live-cam page, plus the Coral City Camera underwater reef project) directly in-session — this is the human-review step `THREAT_MODEL.md` §9 requires, given directly rather than via the moderation queue UI, and is explicitly *not* Task 19's discovery pipeline (still correctly inert). 4 real `camera_sources` rows inserted as `status = 'approved'`, `reviewed_by` set to the founder's real profile id, `reviewed_at` set to the real insertion time — reads identically to a real moderation decision if audited later. Each source's embeddability was verified directly (`curl -I` for `X-Frame-Options`) before insertion, not assumed — YouTube's regular watch/live page URLs block framing, only `/embed/<id>` doesn't, so URLs were corrected to that form. `EMBED_DOMAIN_ALLOWLIST` (`T20.2`) updated to match (`www.youtube.com`, `www.coralcitycamera.com`). Full traceability record: `supabase/sources/webcam-sources.md`. **Not yet done:** an actual ingestion *connector* (a real ETL/monitoring process) — this is allowlist population, not a connector; `~12` more candidate cams from `visitlauderdale.com` remain unverified/uninserted (documented as a next step, not silently dropped).
- [x] `T17.3` Confirm stream embedding/bandwidth stays within free-tier hosting limits — confirmed by design, not just measurement: `src/components/media-embed/media-embed.tsx`'s live-stream (`<video src={current.url}>`) … _(archive)_

### Task 18: Visual Telemetry Extraction Pipeline (→ Task 18, → §9)
- [x] `T18.1` **Decision:** `claude-haiku-4-5-20251001` (cheapest current vision-capable Claude model), per CLAUDE.md's "default to the latest Claude models for AI-backed workers." **Flagged, not silently resolved:** the … _(archive)_
- [x] `T18.2` Scheduled worker to snapshot + call the vision API — `src/app/api/cron/webcam-extraction/route.ts` (`GET` for Vercel Cron, `POST` for manual/dev trigger, both gated on `CRON_SECRET`, fails closed if unset) … _(archive)_
- [x] `T18.3` Store `MODEL_INFERRED` results with confidence score + timestamp — `supabase/migrations/0005_webcam_readings.sql` (`webcam_readings` table: nullable `visibility_meters`/`chop_state`, mandatory `confidence` … _(archive)_
- [x] `T18.4` Distinct UI styling for inferred vs. verified data (reuses P0-B.5 pattern) — `src/components/webcam-readings/reading-badge.tsx`, wraps the existing `ProvenanceBadge`'s `MODEL_INFERRED` treatment rather than reinventing it.
- [x] `T18.5` Hard volume/rate cap on API calls — `src/lib/webcam-extraction/rate-cap.ts`, `DAILY_CALL_CAP = 20` (env-overridable via `WEBCAM_EXTRACTION_DAILY_CALL_CAP`, invalid overrides fall back to the safe default, never … _(archive)_

### Task 19: Automated Webcam Discovery Agent (→ Task 19, → §9)
- [~] `T19.1` Candidate-discovery workflow (LLM-assisted, constrained to allowlist candidates only) — **scaffold only, by explicit founder decision**, per `THREAT_MODEL.md` §9's unresolved "legal review of the scraping/redistribution approach for webcam feeds" gate (not done yet). Real, working pieces: `src/lib/webcam-discovery/extract-candidate.ts` (LLM normalization via `claude-haiku-4-5-20251001`, real Anthropic API call once a key exists) and `submit-candidate.ts` (inserts into `camera_sources` as `pending_review` through the normal authenticated-user RLS path — never the service-role client — so a discovery-agent submission is exactly the same trust level as a human's). **Deliberately inert:** `discover-candidates.ts`'s default `CandidateDiscoverer` does zero network access — returns an empty, founder-curated seed list — and the manual-trigger route (`src/app/api/webcam-discovery/route.ts`, POST-only, signed-in required, max 20/request) requires an authenticated caller to supply candidate URLs directly, with no fallback to autonomous discovery. Do not wire up real web search/crawling here without first confirming the legal-review gate has actually cleared.
- [x] `T19.2` Human-review moderation queue UI — `src/app/moderation/camera-sources/` (server component does the privileged read via the service-role client since RLS only lets a user see their own submissions … _(archive)_
- [x] `T19.3` Approval flow to promote a candidate into the allowlist — never auto-published … _(archive)_

### Task 20: Unified Media Embed & Fallback UI (→ Task 20)
- [x] `T20.1` Media component with fallback order: live stream → embedded player → refreshing stills — `src/components/media-embed/` … _(archive)_
- [x] `T20.2` Sandbox third-party embeds via iframe `sandbox` attribute + domain allowlist — `sandbox="allow-scripts"` only, `allow-same-origin` deliberately omitted (the classic risky pairing … _(archive)_
- [x] `T20.3` Stream-down fallback handling — covered by `T20.1`'s per-tier failure detection above (not a separate mechanism)

**Note:** the Post-Dive Micro-Prompt agent hit a stalled-connection failure near the very end of its run (its last visible message was mid-fix on an unrelated import). Rather than a third resume/retry, I checked the files it left behind directly … _(archive)_

**Note:** `T12.1`, `T18.1`–`T18.5`, and `T19.2`/`T19.3` were built as three parallel agents in isolated git worktrees, then reviewed and merged by hand rather than trusted blind … _(archive)_

**Note:** a second round fanned out `P0-B.4` (rate limiting), `T20.2` (embed allowlist decision), and `T19.1` (discovery-agent scaffold) as three more parallel worktree agents; `T17.3` and `P0-C.3` were resolved directly (verification-only, no code needed … _(archive)_
