# Handoff — Shore-Diving Intelligence & Discovery Platform

Rolling session-to-session handoff. Newest section on top. The authoritative
detail lives in `plan.md` (spec + decisions) and `TASKS.md` (granular tracker);
this file is the fast orientation: *where we are, what just happened, what's next.*

---

## 2026-11-11 — holistic review: offline prefetch made real, maintenance, Supabase outage

**State of the repo**
- Branch **`feature/offline-bundles-and-maintenance`** (off local `main`), committed, **not pushed, not merged**.
- Local `main` is still 5 ahead / 1 behind `origin/main` (origin has PR #8's merge commit for item 25; local has its own merge of the same branch). `git pull --no-rebase` then push resolves it — pushing deploys to production, so it's left for the founder.
- `tsc` / lint / **1078 tests** / build all clean.

**What happened**
- **Supabase project had auto-paused** (free tier, ~1 week idle). Every read failed with `TypeError: fetch failed`, locally and on the deployed app. Founder resumed it from the dashboard this session. Now documented in `CLAUDE.md`.
- **Offline prefetch is real** (`TASKS.md T32`) — was a placeholder. Signed bundle route, verify route, verified save to IndexedDB, auto-save on add-to-dive-plan, `/offline` saved-sites page that doubles as the service worker's no-network fallback.
- **Outage honesty fix** — the map banner said "No dive sites within 25 mi" while the database was unreachable; it now says the data couldn't be loaded.
- **Maintenance** (`T33`) — Next 16.4.6 (critical advisory), shared structured logger, README/CLAUDE.md brought up to date.

**Founder actions**
1. **Set `BUNDLE_SIGNING_SECRET`** (`openssl rand -hex 32`) in `.env.local` and in Vercel (Production + Preview). Until then "Prefetch Now" honestly reports that offline saving isn't set up.
2. Review + merge this branch; sync and push `main`.
3. Supabase will pause again after a week idle — a free keep-alive (e.g. a scheduled ping) is worth deciding on.
4. Still open from before: `plan.md` item 26 (shore-access copy outside S. FL), `NEXT_PUBLIC_LDS_CLAIM_EMAIL`, Vercel Preview env vars, `T15.8` iOS device test (now also worth testing `/offline` there), the Blocked bucket in `plan.md`.
5. Housekeeping: `ATT - Bill And Payment History.pdf` is sitting untracked in the repo root; six merged feature branches can be deleted.

**Next engineering candidates**
- Post-dive / voice logs are still device-only (no `dive_logs` table) — needs a migration, so a founder-applied step.
- Offline bundles carry data only — no images or map tiles; no automatic pre-dive refresh.
- Remaining `npm audit` findings are build-time tooling behind `@serwist/next`; they clear when Serwist updates.

---

## 2026-09-06 — items 24 & 25 merged to `main`

**Accomplishments**
- **Item 24** merged (`42fa015`): `search_sites_near` SQL fn (migration `0016`, applied live) + `listSitesNear()` replace the alphabetical `LIMIT 200` slice; nearest-N within radius, done server-side. +10 tests.
- **Item 25** merged (`45b1c54`): no-coords candidates get a Google Maps link + reveal-on-demand manual lat/long entry (validated client + add-route). +5 tests.
- Merge doc-conflicts (HANDOFF/TASKS/plan) resolved. `tsc`/lint/**1047 passing**/build all clean. Local `main` is **5 ahead of `origin/main` — not pushed yet.**

**Decisions**
- Migration `0016` applied to the live Supabase project by founder before merge.
- Branches merged locally (no `gh` on this machine); push to `main` pending founder OK.

**Session-memory**
- Nothing new for `/memory` — `0016` mechanics + merge state captured here and in TASKS/plan.

**Next**
1. Push `main` to origin (5 commits: 2 merges + this handoff).
2. `plan.md` item **26** — shore-access copy on the preview sheet outside S. FL. Founder judgement, not code.
3. `NEXT_PUBLIC_LDS_CLAIM_EMAIL` → real inbox.
4. Optional dead-code sweep: `listSitesInBounds` / `boundingBoxForRadius` / `sortByDistanceWithinRadius` now unused by app code (kept — tested).

---

## 2026-09-05 (later still) — "Add to map" bugs 27, 28, 29 fixed

Founder live-testing the discovery flow: after discovering sites and clicking
"Add to map", (a) the candidate list refreshed and wouldn't let you add more,
(b) the added pin wasn't clickable through to its detail page, and (c) once one
site was on the map (or after a reload) there was no way back to the rest of the
web-search list or to re-run the search.

- **Item 27** — `handleCandidateAdded` merges the added site into `search.sites`
  for an instant pin, which flipped the `search.sites.length === 0` gate that
  rendered the whole web-search panel → first add unmounted it. Folded into 29.
- **Item 28** — `POST /api/sites/candidates/add` returned a marker built from the
  row PostgREST echoes back, where `numeric` columns (`latitude`/`longitude`/
  `depth_*`) come back as **strings**. String coords → broken GeoJSON feature →
  pin mispositioned / not hit-testable. Route now builds the marker from its
  already-parsed numeric inputs; only `id` comes from the insert. New
  `route.test.ts` (5 tests — first API-route test in the repo).
- **Item 29** — founder decision: **make the web search re-runnable at any
  manually-picked location**, not just where OSM found nothing (rejected local
  candidate persistence / a per-area cache). `dive-site-explorer.tsx`:
  `webSearchAvailableHere = manualCenter !== null && useServerResult` (was the
  `noLocalOrOsmResults` zero-gate), adaptive copy, "Search the web again" link.
  Cost backstop stays the `research-area` daily cap. Not offered at plain GPS.
  No new test — inline render-gating, no render-test harness for this component;
  **needs a manual smoke-test on deploy.**

`tsc`/lint/**1032 passing**/build all clean.

**Still open** (`plan.md` 24–26): 200-site truncation (24), no-coords "research
further" affordance (25), shore-access silence outside S. FL (26 — product
judgement, needs founder input).

---

## 2026-09-05 (later) — discovery-flow bugs 22 & 23 fixed

Fixed and pushed on top of the T24–T30 branch:
- **Item 22** — `manualCenter` (panned-to location) now persists in
  `useExplorerPreferences` alongside the map viewport, so a returning diver keeps
  searching the area they were exploring and an added site reappears.
- **Item 23** — `pageshow`/`event.persisted` listener in `dive-site-explorer.tsx`
  forces one clean re-fetch on bfcache restore.

11 new tests, `tsc`/lint/**1027 passing**/build all clean.

**Still open** (see `plan.md` 24–26): 200-site truncation (24), no-coords
"research further" affordance (25), and shore-access silence outside S. FL (26 —
now understood as a *product judgement* that reverses a deliberate prior decision
on the preview sheet, needs founder input, not a clear bug).

---

## 2026-09-05 — deploy config + discovery-flow bug triage

### State of the repo
- Branch: **`feature/task-22-research-summary`**, pushed to origin.
- Commit **`7edb90d`** = the whole T24–T30 body of work (map-pan discovery,
  five-persona UX audit + fixes, Safe-Return homepage card + PWA nudge, locate-me
  button, mockup-parity pass, voice logging, DAN reference, hazard recency, etc.),
  previously verified but never committed. `tsc`/lint clean, **1023 tests pass**,
  build clean.
- Commits after that: `plan.md`/`UX_AUDIT_CHECKLIST.md` deferral note, and the
  `supabase/README.md` OAuth-config doc.
- **PR not yet opened** — no `gh` CLI on this machine. Compare URL:
  https://github.com/drodriguez74/shore-dive-app/compare/main...feature/task-22-research-summary?expand=1
  PR body was drafted (`scratchpad/PR_BODY.md`).

### Accomplishments this session
1. **Committed + pushed T24–T30.** One commit by deliberate choice — the work was
   too interleaved in the working tree to retro-split safely.
2. **Fixed Google sign-in redirect on the deployed app.** Was bouncing users back
   to `localhost:3000` after the Google OAuth handshake. Root cause: Supabase
   **Site URL** / **Redirect URLs** still pointed at localhost; the app code was
   already correct (`window.location.origin` / `request.nextUrl.origin`). Founder
   updated the Supabase dashboard; **confirmed working**. Documented in
   `supabase/README.md` § "Auth / OAuth URL configuration (P0-A)".
3. **Fixed AI discovery in production.** `GEMINI_API_KEY` was missing from Vercel
   production env — Brave retrieval worked, Gemini extraction threw. Founder added
   the key + redeployed; Vercel logs confirm `candidates: 10, error: null` after.
4. **Got Vercel access** (`vercel login` in-session, project linked) — logs are
   now readable for debugging.

### Discoveries (bugs found, NOT yet fixed)
Tracked as `plan.md` items 22–26 / `TASKS.md T31`:
- **Added sites vanish on navigation.** `/api/sites/candidates/add` *does* persist
  a real `sites` row (`provenance: COMMUNITY`) — confirmed in logs. But
  `handleCandidateAdded` only holds it in memory; navigating away and back
  re-searches around the diver's real GPS, not the panned area, so it drops off.
- **Search stuck until hard refresh after browser-Back** — suspected bfcache; the
  aborted in-flight `search-nearby` fetch isn't retried on page restore.
- **`search-nearby` truncates at 200 sites** in dense areas (hit live in South
  Florida) — silently incomplete pins/list.
- **No-coordinates candidates are a dead end** — "Add to map" correctly disabled,
  but just a greyed button.
- **Shore-access UI goes silent outside South Florida** — `shore-access.ts` only
  has entry-point data for S. FL; elsewhere no distance, no line, and no "boat
  access" label either. Should say *something*.
- **Vercel env vars are Production-only** — Preview deployments have no keys.

### Decisions made
- **Voice-transcription privacy copy** (`plan.md` item 20): **pinned until
  prod-ready.** Still POC, no live app; the shipped honest-disclosure copy
  (`on-device`/`browser-service`/`unknown`, failing pessimistic) stays as the safe
  default. Not a blocker.
- **T24–T30 → one commit**, not retro-split per task.
- **OAuth URL config stays dashboard-only** — app code remains
  deployment-agnostic; env differences live in the Supabase + Google Cloud
  dashboards, documented in `supabase/README.md`.

### What to work on next
**In priority order:**
1. **Open the T24–T30 PR** (founder action, or install `gh`), review, merge to
   `main`. Confirm migrations `0013` + `0015` are applied to the live project
   first (status says they are — re-verify).
2. **Discovery-flow bug batch** (`plan.md` 22–26) — highest user-facing value,
   founder is actively hitting these:
   - persist/re-fetch added sites across navigation (item 22)
   - bfcache `pageshow` re-run handler (item 23)
   - "boat access" / "not assessed here" label outside the shore-access model (item 26)
   - then the 200-site truncation (item 24) and no-coords affordance (item 25)
3. **Set `NEXT_PUBLIC_LDS_CLAIM_EMAIL`** to a real monitored inbox before the LDS
   claim flow is useful (Vercel env + local).
4. **Add all API keys to Vercel *Preview*** env too if preview-branch testing
   matters.

### Still blocked on founder decisions (unchanged)
Privacy policy · real moderator-role gate · Safe-Return liability/LLC · webcam
legal-review · infra cost ceiling · operational-continuity status page ·
RapidAPI/divestop licensing. See `UX_AUDIT_CHECKLIST.md` Blocked section.
