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
 * Model choice: Claude Haiku 5.5 — the cheapest vision-capable Claude model
 * as of 2026-11 ($0.10 / $0.50 per MTok for prompts up to 100K tokens).
 * Reconfirm against the `claude-api` skill before enabling real spend.
 *
 * Haiku 5.5 thinks by default and thinking counts toward `max_tokens`, so
 * callers pair this model with `WEBCAM_WORKER_MAX_TOKENS` and low effort —
 * a cap sized only for the JSON answer can be used up before any text.
 */
export const WEBCAM_EXTRACTION_MODEL_ID = "claude-haiku-5-5";

/** Room for brief thinking plus a small structured-JSON answer. */
export const WEBCAM_WORKER_MAX_TOKENS = 2048;
