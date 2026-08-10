# Adversarial Threat Model — Shore-Diving Intelligence & Discovery Platform

Companion to `plan.md`. This document exists to break the plan before implementation does — every pillar and backlog task is examined for failure modes, abuse vectors, and internal contradictions. Findings are ranked by severity. Nothing here is implemented yet; treat unresolved **Critical** items as blockers to writing the first line of code for the affected feature.

**Status: resolved via founder interview, reflected in `plan.md` (Hardened Spec v4).** The findings below are the original reasoning; `plan.md` has the actual decisions. Several are worth flagging because the resolution differs from what this document originally proposed:

- **§0.1 (Safe-Return connectivity contradiction):** originally proposed a layered SMS+push+local-alarm strategy. Given the confirmed no-budget/solo context, v1 instead ships **local-only** (on-device alarm, no remote alerting at all) with an explicit "this doesn't notify anyone else" disclaimer. This resolves the contradiction by not promising a capability the app can't back yet, rather than by engineering around it.
- **§1 (map pin geofuzzing):** originally proposed fuzzed coordinates behind a reveal gate, borrowing a pattern from rare-species/foraging-location apps. On review, that premise doesn't hold for shore diving — coastlines are public and walkable, and viable sites are generally already documented elsewhere, so fuzzing doesn't protect a genuinely secret resource. v1 uses exact coordinates with an explicit access/legal-status badge for the real distinct concern (protected areas, private property, seasonal closures).
- **New, post-resolution finding — platform pivot reopened §0.1 partially:** the plan moved from a native Expo/React Native app to a Next.js PWA on Vercel (see `plan.md`'s "Platform Decision"). This fixed real problems (app-store cost/review, easier Mapbox integration, trivial hosting) but reintroduced a version of the Safe-Return connectivity/reliability problem: even the local-only, zero-network alarm this document's §0.1 resolution depends on isn't fully reliable on the web once the app is backgrounded — no flashlight/torch API on iOS Safari at all, no guaranteed background execution, notifications gated behind iOS 16.4+ and an "Add to Home Screen" install. **Founder decision: accept this and disclose it clearly in-app rather than block v1 on a native wrapper.** This is a conscious, documented risk acceptance, not an oversight — if this project later gets a budget or real users, revisit whether a thin native wrapper (e.g. Capacitor) is worth it for this one feature specifically.

The rest of the findings below (offline staleness/integrity, community data-provenance/abuse, webcam ToS/legal exposure, WebView/iframe sandboxing, PII/auth) are resolved as originally proposed, scoped down where v1's reduced feature set (no emergency contacts, free/cheap-tier-only AI) shrinks the actual exposure — see `plan.md` for specifics. Where the original findings refer to native-specific mechanisms (Expo background tasks, WebView), read those as their web equivalents (service worker/IndexedDB, sandboxed iframe) per the platform pivot.

Severity key: **Critical** = someone could get physically hurt, or the org faces legal/existential exposure. **High** = core product promise breaks or user data is exposed. **Medium** = degraded trust/UX or moderate engineering risk. **Low** = worth noting, not blocking.

---

## 0. Foundational contradictions

These aren't bugs in a feature — they're conflicts between pillars that must be resolved at the architecture level before Phase 1 starts.

### 0.1 Offline-first vs. the emergency alert that needs a network — **Critical**
Pillar 2 promises full functionality with **zero cellular coverage**. Task 15 (Safe-Return timer) promises **automated emergency contact alerting** on a missed check-in. These are the same remote shore site, the same dive, the same missing signal. If the phone has no signal to cache hazard maps, it has no signal to send an SOS when the diver doesn't return — and that's precisely the moment the feature exists for.

**Spec hardening required before Task 15 starts:**
- Define what "alert" means with zero connectivity. Candidate mitigations, not mutually exclusive:
  - Local-first fallback: on countdown expiry with no signal, trigger a loud on-device alarm/flashlight strobe so the diver themselves (if conscious, just late) or nearby beachgoers notice — this is the only option that requires zero network.
  - Opportunistic send: retry alert delivery continuously in the background as soon as any signal (even one bar) returns; show the user/contact a "last known good signal" timestamp so a delayed alert isn't mistaken for a real-time one.
  - Satellite fallback (e.g., device SMS-via-satellite on newer iPhones, or a partner SDK) — expensive, deferred, but should be an explicit "not doing this in v1, here's why" line rather than a silent gap.
  - Pre-dive paper/manual backup: the app should *explicitly instruct* users to also tell a real human their plan before diving in a no-signal zone, because software cannot be trusted to be the only safety layer. Bake this into onboarding copy, not just an FAQ.
- Whatever is chosen, the UI must never imply "help is coming" when the app cannot guarantee delivery. A false sense of security is worse than no feature.

### 0.2 Zero-monetization vs. an infra-heavy backlog — **Critical**
LLM vision extraction (Task 18), an LLM-assisted scraping agent (Task 19), live webcam ingestion (Task 17), map tiles, CDN'd offline asset bundles (Task 12), and any SMS/telephony for emergency alerts (Task 15) all scale with user count and all cost money. "100% free core utility" with no stated revenue model means these costs are either absorbed indefinitely by the founder/org or the service degrades/dies at some unpredictable point.

**Spec hardening required:**
- Write an explicit cost ceiling and degradation plan: if funding runs out, which features go dark gracefully vs. which must never silently disappear (the Safe-Return timer's *failure mode* must be "clearly tells the user it's unavailable," never "silently does nothing").
- Consider gating the expensive features (LLM webcam analysis, scraping agent) behind sponsor/partner arrangements (dive shops, tourism boards) rather than general-purpose infra spend, so cost scales with partnerships, not raw DAUs.

---

## 1. Map-Driven Exploration Engine — **High**

**Failure/abuse scenarios:**
- **Site-loved-to-death**: publishing exact GPS pins for "hidden shore dive gems" is an advertisement to overcrowd and physically damage the exact fragile sites the product claims to protect access to (coral/kelp trampling, poaching, parking/access conflicts with locals). This is the single biggest reputational risk in the whole plan — dive communities are notoriously protective of secret spots specifically because of this dynamic.
- **Data integrity / trust attack**: telemetry pins are presumably community- or sensor-sourced. Nothing in the plan defines a moderation or provenance layer. A bad actor could mark a hazardous site as "clear" to prank/harm someone, or mark a good site as "hazardous" to suppress traffic (competitive dive shop sabotage is a real incentive here).
- **Stalking via dive history**: if pins are tied to logged dives per user, an attacker who can see "this account dives here every Saturday morning" has a location pattern on a real person.

**Spec hardening:**
- Default to fuzzed/generalized pin locations for undeveloped or fragile sites, with exact coordinates revealed only after an explicit "I understand the impact of sharing this location" gate, mirroring how backcountry/foraging apps handle sensitive locations.
- Every telemetry data point needs a provenance + trust tier (verified official source vs. community-submitted vs. inferred-by-model) rendered in the UI, not just a color pin with no lineage.
- Rate-limit and require reputation/history before a user's hazard report can flip a site's public status; log all status-changing edits with attribution for abuse investigation.
- Never expose a per-user dive history/pattern to anyone but that user and their explicitly designated emergency contacts.

## 2. Intent-Driven Offline Cache — **High**

**Failure/abuse scenarios:**
- **Stale-data-as-safety-data**: a hazard map cached 24h before the dive window is, by construction, up to 24h+ old by the time the diver is standing at the water's edge. A storm advisory or rip current warning issued in hour 23 never reaches a phone that's already offline. The "fully cached" badge (Task 13) can look identically green whether the underlying data is 10 minutes or 23 hours stale.
- **Cache poisoning / tampering**: no mention of integrity verification on the offline bundle. If the CDN/backend is compromised or a MITM occurs during prefetch (e.g., on hotel/marina wifi before heading out), a tampered hazard map is indistinguishable from a legitimate one once cached.
- **Battery/storage exhaustion**: background prefetch of images + hazard data on a budget Android phone can drain battery or fill storage, which is its own safety risk if the phone dies before the Safe-Return timer's countdown completes.

**Spec hardening:**
- Every cached hazard/condition datum must carry a visible "as of [timestamp]" and staleness threshold in the UI — never just a binary cached/not-cached indicator. Task 13's "sync status" spec should be redefined as *freshness* status, not just completeness.
- Sign or checksum offline bundles server-side and verify on the client before marking a site "ready offline"; a corrupted or tampered bundle must fail closed (shown as not-cached) rather than fail open.
- Cap background prefetch by available storage/battery, and warn the user rather than silently degrading the dive plan they're relying on.

## 3. Frictionless Voice Logging — **Medium**

**Failure/abuse scenarios:**
- Direct conflict with Pillar 2: if voice-to-text runs via a cloud STT/LLM API, it doesn't work at the exact remote, no-signal sites the app is built around — "frictionless" logging becomes "log it later when you have signal, and hope you remember."
- Misrecognition risk on safety-adjacent numbers ("45 feet" heard as "15 feet") silently corrupts a logbook that could feed future dive planning (e.g., repetitive-dive nitrogen calculations, if ever added) with no verification step before it's saved.
- Audio containing a dive buddy's or bystander's voice/identifying info gets uploaded to a third-party STT/LLM provider without their consent — a privacy question the plan doesn't address.

**Spec hardening:**
- Prefer on-device speech-to-text (both iOS and Android now ship on-device STT APIs) so logging actually works offline, consistent with Pillar 2; queue only if cloud fallback is used for accuracy.
- Always show the transcribed structured fields for a one-tap confirm/edit before saving — never auto-commit numbers (depth, runtime) straight from a transcript.
- State a retention/consent policy for any audio that does leave the device.

## 4. Zero-Monetization Growth Strategy — see §0.2

## 5. Task 12/13 — Prefetch pipeline & sync status UI — **High**

- **Platform reality check**: iOS background execution (BGTaskScheduler under Expo's `expo-background-fetch`/`expo-task-manager`) is opportunistic and OS-throttled — the OS decides *if and when* background fetch runs, not the app. A "trigger prefetch 24h before the dive window, guaranteed" spec item is not achievable as literally stated on iOS in the Expo managed workflow. Android's Doze/App Standby imposes similar (if less strict) limits.
- **Spec hardening:** rewrite the requirement as best-effort background prefetch with an explicit, prominent in-app fallback: prompt the user to foreground-prefetch manually before leaving connectivity if background prefetch hasn't completed by trip time. Never let the UI imply background prefetch is guaranteed.
- Covered above for staleness/integrity (§2).

## 6. Task 14 — Post-Dive Micro-Prompt Engine — **Medium**

- Detecting "post-dive" state presumably infers from GPS/motion — false positives (walking near shore, driving past a dive site) trigger unwanted prompts, directly violating the "zero-noise" promise in Pillar 1. False negatives mean the capture window is missed and the frictionless-logging pillar fails silently.
- **Spec hardening:** define explicit, conservative trigger conditions (e.g., requires an active dive-plan check-in state, not just GPS proximity) and let users tune/disable inference-based prompts without losing the ability to manually log.

## 7. Task 15 — Safe-Return Emergency Timer — **Critical** (highest priority in the whole backlog)

Beyond the connectivity contradiction in §0.1:

- **App lifecycle kill**: iOS aggressively suspends/kills backgrounded apps; a countdown implemented as an in-JS timer will not survive being swiped away or the OS reclaiming memory. This must be built on OS-level scheduled local notifications / background tasks specifically designed to survive app termination, not a running timer in app state.
- **Alert fatigue → feature abandonment**: if checking in is fiddly (multiple taps, requires signal, requires app foregrounded), tired/cold divers will forget, generating false alarms. Enough false alarms and (a) emergency contacts start ignoring alerts entirely, which defeats the entire feature, and/or (b) users disable the timer out of annoyance. Both outcomes convert a safety feature into a false-safety liability.
- **Who actually gets alerted, and how**: "automated emergency contact alerting" is undefined. If it's a push notification, the contact must have the app installed — unrealistic for most family/emergency contacts. If it's SMS, that's a per-message telephony cost (conflicts with §0.2) and needs a real provider (Twilio et al.) plus phone-number verification/consent flow for the contact. This needs to be a resolved decision, not an implied detail.
- **Liability**: this is, functionally, an emergency-alerting / life-safety system built by a small team with no monetization and (implicitly) no dedicated safety/compliance review. If it fails silently and someone is harmed, the product is directly implicated. Recommend: explicit liability disclaimers surfaced at setup (not buried in ToS), a "this is a backup, not a replacement for telling a real person your plan" framing baked into onboarding, and a legal review before this ships to any real users — flagged here as a business risk, not just an engineering one.
- **Access control**: a shared or stolen phone could mark a check-in on behalf of a diver who is not actually safe. Low likelihood, but worth a line in the spec (e.g., require explicit unlock/biometric to check in, not a lock-screen quick action).

**Spec hardening summary for Task 15:** this task should not start implementation until 0.1's connectivity fallback strategy, the alert delivery mechanism/cost owner, and the liability/disclaimer language are all explicitly decided and written down — not deferred to "we'll figure it out while building."

## 8. Task 16 — Local Dive Shop (LDS) Logistics Layer — **Medium**

- Same staleness problem as hazard data: a fill station shown as "open/stocked" that's actually closed can strand a diver who planned air refills around it. No source-of-truth or freshness model defined.
- **Spec hardening:** apply the same provenance + "as of" timestamp treatment as §1/§2; never show a binary open/closed status without a last-verified time.

## 9. Tasks 17–19 — Webcam ingestion, vision extraction, automated discovery agent — **Critical** (legal/ethical), **High** (safety chain)

This cluster carries the most legal exposure in the entire backlog and deserves the most scrutiny:

- **ToS / scraping legality**: "aggregate public coastal weather, surf, and underwater cam streams" and a "scheduled scraping worker using LLM-assisted extraction to find and index... dive shop and municipal beach cameras" — most webcam providers' ToS prohibit automated scraping and redistribution of their video streams. Indiscriminate, agent-driven discovery at scale (Task 19) multiplies this exposure across every camera it finds, with no human review gate implied in the spec as written. This risks takedown notices, IP bans, and potential legal action, and could burn relationships with the exact local dive shops the product wants as allies (Task 16).
- **Privacy of bystanders**: public beach/parking-lot cameras incidentally capture identifiable people and vehicles. Re-hosting/reprocessing that footage (even via a vision model, even transiently) raises privacy questions in some jurisdictions, independent of whether faces are ever "recognized."
- **Safety-chain risk from bad inference**: Task 18's vision worker estimates visibility/chop from a webcam snapshot and that estimate feeds a map a diver uses to decide whether to dive. A fogged lens, a camera pointed the wrong way, a stale cached frame served by the source as if live, or a plain model error all produce a wrong "good visibility" signal that a diver could rely on to make an unsafe call. This is a second life-safety-adjacent data path (alongside §2) that the plan doesn't currently flag as such.

**Spec hardening:**
- Replace "scheduled scraping worker" with an **allowlist/partnership model**: only ingest camera feeds from sources with explicit permission (municipal open-data feeds, opted-in dive shops) rather than indiscriminate discovery. If Task 19's discovery agent stays in scope, its output should populate a review queue for human approval, never auto-publish a newly found camera as a trusted source.
- Every vision-derived estimate (Task 18) must be labeled as an estimate with a confidence score and timestamp, visually distinct from verified/official readings — never rendered with the same pin styling as authoritative hazard data (ties into §1's provenance-tier requirement).
- Get explicit legal review on the scraping/redistribution approach before Task 17 implementation starts, not after cameras are already being indexed.

## 10. Task 20 — Unified Media Embed & Fallback UI — **Medium**

- If the "embedded players" fallback uses a React Native WebView to render third-party player iframes, that's untrusted third-party content running in an app context — a real XSS/clickjacking surface if the WebView isn't sandboxed (disabled JS injection, restricted navigation, no exposed native bridge to that WebView instance).
- **Spec hardening:** treat any embedded third-party player as untrusted content: strict WebView sandboxing, no shared cookie/session context with the app's own auth, and an allowlist of embeddable domains rather than rendering arbitrary embed URLs.

## 11. Cross-cutting concerns not owned by any single task

- **No auth/identity model defined.** Emergency contacts, dive plans, and voice logs all need to be tied to a user securely, and none of that is in the plan yet. This has to exist before Task 15 can be built at all.
- **No data classification for PII.** Emergency contact phone numbers, real-time location during a dive, and countdown-timer state together constitute a genuinely sensitive PII store — a breach here has physical-safety implications (stalking/whereabouts exposure), not just a privacy embarrassment. Needs encryption at rest/in transit and explicit minimal-retention policy in the spec, called out ahead of Phase 1, not bolted on later.
- **No community moderation/abuse-prevention model** for any of the community-sourced data (hazard reports, LDS status, site reviews) despite the product depending on community data throughout §1 and §8.

---

## Recommended pre-implementation checklist ("spec ready" gate)

Before Phase 1 (Tasks 12–13) starts:
- [ ] Resolve §0.1 — decide the Safe-Return alert delivery/fallback strategy in writing.
- [ ] Resolve §0.2 — write a cost ceiling + graceful-degradation plan for infra-heavy features.
- [ ] Define an auth/identity model (needed for emergency contacts and dive plans regardless of which task ships first).
- [ ] Define the data provenance/trust-tier model for map pins (§1) — needed before any pin rendering exists, so it isn't retrofitted.
- [ ] Rewrite Task 12/13's spec language to "best-effort background prefetch + manual fallback" rather than a guaranteed background trigger (Expo/OS reality, §5).

Before Task 15 specifically starts:
- [ ] Alert mechanism + cost owner decided (SMS provider? push-only? satellite?).
- [ ] Liability/disclaimer language drafted and reviewed.
- [ ] OS-level (not in-JS) timer/notification architecture confirmed feasible in Expo managed workflow, or a decision to move to bare/EAS custom dev client made explicitly.

Before Tasks 17–19 start:
- [ ] Legal review of the scraping/redistribution approach for webcam feeds.
- [ ] Allowlist/partnership sourcing model in place of indiscriminate scraping.
