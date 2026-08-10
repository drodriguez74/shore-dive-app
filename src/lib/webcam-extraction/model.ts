/**
 * T18.1 — model selection for the Visual Telemetry Extraction Pipeline.
 *
 * ============================================================================
 * FOUNDER-CONFIRMATION ITEM — read before ever setting WEBCAM_EXTRACTION_ENABLED=true
 * in a real environment. This is a real-money decision this code deliberately
 * does NOT make silently.
 * ============================================================================
 *
 * CLAUDE.md's Architecture section says to default to the latest Claude
 * models for AI-backed workers like this one. But CLAUDE.md's Engineering
 * standards *also* say: "No paid dependency without checking the funding
 * model — this is a no-budget solo project; any new SDK/API/service must
 * fit a free or negligible-cost tier, or be flagged to the founder before
 * use." Those two directives are in real tension here, and this file
 * doesn't quietly resolve it in either direction:
 *
 *   - The Anthropic API has **no free tier** at all — unlike, say, a vision
 *     API with a free monthly request quota. Every call this pipeline makes
 *     is real, metered spend from the first request on, which is a genuine
 *     mismatch against plan.md's Resolved Decision 2 ("Webcam vision-AI
 *     (Task 18) bounded to free/cheap-tier APIs only... accept lower
 *     quality/coverage over cost risk").
 *   - Resolving it the way this codebase resolves similar tensions
 *     elsewhere (P0-A.1/T12.1's founder-blocked external-account items;
 *     0003_camera_sources.sql's documented-not-papered-over service-role
 *     gap): pick the cheapest vision-capable Claude model available, gate
 *     all real usage behind a hard, conservative, low daily call cap
 *     (T18.5 — see rate-cap.ts, DAILY_CALL_CAP), and treat "actually turn
 *     this on against real API spend" as a founder-confirmation item, not
 *     something this code switches on for you. WEBCAM_EXTRACTION_ENABLED
 *     (checked in run-extraction.ts) defaults to unset/false for exactly
 *     this reason — flipping it to "true" in a deployed environment is the
 *     founder's decision to make, informed by this comment, not an
 *     incidental side effect of merging this code.
 *
 * Model choice itself: `claude-haiku-4-5-20251001` is the cheapest
 * vision-capable Claude model as of when this file was written ($1/$5 per
 * MTok input/output, vision-capable, 200K context — well below every
 * Sonnet/Opus-tier price point). Anthropic's model lineup and pricing change
 * over time — **reconfirm this against current model IDs (the `claude-api`
 * skill, or https://platform.claude.com/docs/en/about-claude/models/overview)
 * before enabling this against a real ANTHROPIC_API_KEY**, don't assume this
 * constant is still the cheapest option by the time anyone flips the
 * feature flag on.
 */
export const WEBCAM_EXTRACTION_MODEL_ID = "claude-haiku-4-5-20251001";
