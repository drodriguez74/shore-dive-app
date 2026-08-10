# Creative Backlog

Tracks UX/visual design work in `creative/`, parallel to `TASKS.md`'s engineering tracker. Same status markers: `[ ]` not started · `[x]` done · `[~]` in progress.

Every flow here must be designed against `creative/design-system/DESIGN_SYSTEM.md` — that document is the constraint set, not a suggestion, so parallel work stays visually and tonally consistent.

**See `creative/AESTHETIC_REVIEW.md`** for the 2026-08-08 five-lens visual/craft review of the rendered mockups (distinct from `plan.md`'s content/domain review) — two real bugs found and fixed (light-mode contrast on the Safe-Return check-in button, and the moderation security notice's tone), plus a triaged backlog of what's real-but-deferred and what needs a founder decision before any work happens.

## Round 1 — 2026-08-07

- [x] **Onboarding + Google sign-in** — first-run experience, sign-in screen, honest permission priming (location, notifications, mic). `creative/flows/onboarding.md`, `creative/mockups/onboarding/` (7 screens). Reviewed: permissions requested contextually per-feature (never a launch gauntlet), every "not now" path stays fully functional, denied states disclosed calmly rather than hidden, no Apple/Facebook sign-in added (Google-only cost rationale preserved verbatim).
- [x] **Map exploration + site detail** — color-coded pins, provenance/legal-status badges, site detail view, offline freshness. `creative/flows/map-exploration.md`, `creative/mockups/map-exploration/` (7 screens). Reviewed: pin fill = hazard-report signal (never a red/green safety verdict), pin ring = provenance reusing `ProvenanceBadge`'s exact hex values (spot-checked identical), no geofuzzing reintroduced, all 5 `legal_access_status` states covered including `null` as a distinct non-"open" state with `MODEL_INFERRED`'s dashed-border grammar reused correctly.
- [x] **Safe-Return timer lifecycle** — start, running countdown, check-in, expiry/alarm. Life-safety-critical — honest-disclosure tone required, no implied guarantees. `creative/flows/safe-return.md`, `creative/mockups/safe-return/` (5 screens). Reviewed: every honest-disclosure copy string spot-checked verbatim against the real components (disclaimer, compact reminder, expired-state copy, button labels) — none softened. Expired/alarm screen resolves urgency-without-panic via color/motion only (slow rose pulse, not new copy), never implies outside help is coming.

## Round 2 — 2026-08-07

- [x] **LDS + webcam moderation (admin-facing)** — fill-station status feed, camera moderation queue. `creative/flows/lds-moderation.md`, `creative/mockups/lds-moderation/` (5 screens). Reviewed: security-gap notice copy spot-checked verbatim against the real `SecurityGapNotice` component, rendered persistently (no dismiss) on every screen that needs it — screen 04 demonstrates persistence via real sticky-scroll rather than just asserting it. No fake moderator-role badge invented. Admin screens deliberately widened to an 820px desk frame with 36px approve/reject buttons (below the app's 44px wet-hands rule, but justified: desk/mouse context, still clears WCAG 2.5.8's 24px AA floor) — documented, not a corner cut.
- [x] **Post-dive voice logging** — micro-prompt, voice capture, transcription confirm/edit step, structured logbook entry. `creative/flows/voice-logging.md`, `creative/mockups/voice-logging/` (6 screens). Reviewed: real trigger logic verified exactly (15-minute recency window, never fires on `expired`), confirm/edit enforced three redundant ways (no diagram edge skips it, dashed "Transcribed" vs. solid "Edited" per-field tags, persistent draft copy), manual-entry fallback treated as first-class rather than an apology screen.
- [x] **Offline prefetch + sync status** — pre-trip checklist, "Prefetch Now," freshness/staleness badges. `creative/flows/offline-prefetch.md`, `creative/mockups/offline-prefetch/` (8 screens). Reviewed: `FreshnessBadge`'s real 12h staleness threshold matched exactly (8h shown as fine, 14h shown as stale), freshness comparison sheet spot-checked to use only emerald/amber, never a red/green binary or rose (rose reserved for the failed-fetch banner only). Failed-prefetch state correctly shows a prior cached record surviving untouched, matching `bundle-verification.ts`'s real fail-closed behavior.

## Shipped into the real app — 2026-08-07

The design system is no longer reference-only. `creative/design-system/tokens.css` is merged into `src/app/globals.css`, Space Grotesk is wired via `next/font/google` in `src/app/layout.tsx`, and the depth scale / Dive Gradient / `rose`-for-danger semantic are applied to `src/app/page.tsx`, `src/app/login/page.tsx`, `src/app/safe-return/page.tsx`, and every component under `src/components/safe-return/`. Presentation-only — verified independently (not just trusting the agent report) that no props, state, event handlers, or honest-disclosure copy changed anywhere in the Safe-Return components. One real, flagged judgment call: the Google sign-in button was deliberately left unthemed for dark mode, since Google's own brand guidelines dictate that button's exact look — the gradient lives as a glow behind the card instead, not on the button.

Not yet restyled (out of scope for this pass, no corresponding approved mockup to match against): `status-panel.tsx`, `provenance-badge.tsx`, `freshness-badge.tsx`, and `disclaimer-notice.tsx`'s compact variant — their existing zinc/amber treatment already matches `DESIGN_SYSTEM.md` §2.2 as-is. The map, onboarding, voice-logging, offline-prefetch, and LDS/moderation flows are still mockup-only — this pass only wired Safe-Return + the two top-level pages it was scoped to.

## After a round lands

1. Review each flow's mockups against `DESIGN_SYSTEM.md` for consistency (palette, type, touch targets, tone) before marking `[x]`.
2. Publish the strongest 1-2 screens per flow as Artifacts for quick visual sign-off.
3. When ready to build a real synced component library from these mockups, run `/design-sync` yourself — it's restricted to explicit user invocation, not something built into this workflow automatically.
