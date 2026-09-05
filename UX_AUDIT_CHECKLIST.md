# UX Audit Task Checklist

Compiled from the current session context: `TASKS.md T25`'s five-persona UX audit, every subsequent `plan.md` v5.x addition, the Optional/Bonus and Blocked buckets, and two stale doc contradictions found and corrected while compiling this list (Task 14's post-dive trigger and the offline-prefetch pillar were both already wired/reachable — `plan.md`'s older passages said otherwise and have been corrected in place, not re-fixed as if broken).

Excludes anything already resolved this session (`T24`–`T29`) and anything explicitly deferred by prior founder decision (dive-shop value exchange/outreach, Task 22's v2 expansion, role-aware entry points) — those are not bugs, they're scope decisions already made.

## Immediate — small, safe, self-contained copy/hardening fixes

- [x] Add a DAN (Divers Alert Network) reference to the Safe-Return disclaimer copy — `TASKS.md T30`, number independently verified against dan.org
- [x] Add explicit buddy-system solo-only clarification to the Safe-Return disclaimer ("this confirms *you* checked in — it does not confirm your buddy did") — `TASKS.md T30`, on all four Safe-Return surfaces
- [x] Add `noindex` meta tags to the two admin/moderation routes (`/moderation/camera-sources`, `/webcam-discovery`) — `TASKS.md T30`, live-verified in served HTML
- [x] Add a community-sourced/may-be-wrong liability disclosure line to the LDS fill-stations list — `TASKS.md T30`, on both the map popup and `/fill-stations`

## Near-Term — real feature work, independently scoped

- [x] Expand voice-logging structured fields: tank pressure (start/end), buddy name, water temp/exposure suit (currently: max depth, runtime, marine life, conditions) — `TASKS.md T30`. Entry/exit time deliberately not added — reasoning recorded in `src/lib/voice-logging/types.ts`
- [x] Add hazard-report recency/staleness visual weighting on the map — a report should visually recede past an age threshold rather than carrying the same weight indefinitely (mirrors `FreshnessBadge`'s existing staleness treatment for offline cache) — `TASKS.md T30`, three-tier fresh/aging/stale, both the detail-page list and a de-emphasized pin fill

## Long-Term / Optional — larger scope, lower priority, not assigned this round

- [ ] Structured hazard/site fields beyond free-text `description` (entry difficulty, parking notes, `hazard_type`, severity tier) — free-text `description` is an explicitly acceptable v1 answer
- [ ] Certification/experience-level site tags, entry-point-vs-dive-site dual coordinates, weather/beach-access data, diver-down-flag mention
- [ ] Pin-icon legibility/aesthetic pass through `creative/AESTHETIC_REVIEW.md` — a polish question, not a functionality gap

## Blocked — pending a founder decision; not assigned to agents

- [ ] Privacy policy page (`/login` link) — needs a go/no-go on drafting now vs. waiting until real users are imminent
- [ ] Real moderator-role column + full admin-route access control — needs a go/no-go on whether launch is the right trigger
- [ ] Safe-Return liability / business-entity decision (LLC formation, a legal-aid consult)
- [ ] Webcam legal-review gate (`THREAT_MODEL.md` §9) — blocks any real shop-outreach solicitation for Task 17/19
- [ ] Cost ceiling for core infra + Vercel Hobby-tier ToS check
- [ ] Operational-continuity status page/incident notice (P0-D) — go/no-go on building now vs. accepted risk
- [ ] RapidAPI pricing-tier confirmation / `dulcetgnome/divestop` reuse-permission — external data-source decisions, not engineering work
