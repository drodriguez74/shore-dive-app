/**
 * Pure request-body validation, normalization, and failure classification
 * for the community LDS status-submission route
 * (`src/app/api/lds/submit/route.ts`, Task 16).
 *
 * Extracted out of the route handler on purpose: this is the only part of
 * that write path with real branching logic, and this codebase's standing
 * discipline is that meaningful logic gets a pure function with real unit
 * coverage rather than living inline in a handler that can only be
 * exercised over HTTP (`src/lib/dive-plans/pretrip-entries.ts`,
 * `src/lib/sites/distance.ts`, and `lds-status.ts`'s own
 * `latestStatusPerShop`/`sortFillStations` all follow the same split).
 *
 * SECURITY / PROVENANCE INVARIANT — read before changing `ParsedLdsSubmission`:
 * `provenance` and `created_by` are deliberately NOT fields on the parsed
 * result. `lds_status`' RLS policy (`supabase/migrations/0002_rls.sql`,
 * `lds_status_insert_own`) is `with check (created_by = auth.uid() and
 * provenance = 'COMMUNITY')`, so the database is the real enforcement
 * point — but the route must never be in a position to forward a
 * client-supplied value for either one. Keeping them off the parsed type
 * makes that a compile-time guarantee rather than a code-review promise:
 * the route can only get `created_by` from the authenticated session and
 * can only hardcode `provenance`. A body carrying `provenance: "VERIFIED"`
 * is ignored, not rejected — it can't reach the insert either way, and
 * rejecting it would only tell an attacker which field name to keep
 * probing. There is a test asserting exactly this.
 */

import { LDS_STATUS_VALUES, type LdsStatusValue } from "@/components/lds/lds-status";

/**
 * App-layer sanity cap on shop name. `lds_status.name` is an unbounded
 * `text` column, so this isn't mirroring a database constraint the way the
 * coordinate ranges below are — it's a bound on what a single submission
 * can write, so a runaway/abusive client can't push a megabyte of text into
 * a public, community-provenance table. Generous enough for any real dive
 * shop name.
 */
export const MAX_SHOP_NAME_LENGTH = 160;

/**
 * The fields a community submitter actually controls. Note what's absent:
 * `provenance`, `created_by` (see the module header), and
 * `last_verified_at`/`created_at`/`id`, which Postgres defaults own — a
 * submitter can't backdate a report to make a stale status look fresh,
 * which matters because `last_verified_at` is exactly what a diver reads to
 * decide whether to trust an "open" before driving to a fill station
 * (THREAT_MODEL.md §8).
 */
export interface ParsedLdsSubmission {
  site_id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  status: LdsStatusValue;
}

export type LdsSubmissionParseResult =
  | { ok: true; value: ParsedLdsSubmission }
  | { ok: false; error: string };

/** Canonical 8-4-4-4-12 hex UUID. `site_id` is a real `uuid` FK column, so a
 * malformed value would otherwise reach Postgres and come back as an opaque
 * `22P02 invalid input syntax` — a 400 with a clear message here is both
 * cheaper and more honest than a 500 from a type cast. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStatusValue(value: unknown): value is LdsStatusValue {
  return typeof value === "string" && (LDS_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Validates and normalizes a decoded JSON request body into exactly the
 * columns the route is allowed to insert. Returns a result object rather
 * than throwing — the route's job is to turn a failure into a 400 with the
 * message, and an exception-based control flow here would just be a
 * try/catch pretending to be validation.
 */
export function parseLdsSubmissionBody(body: unknown): LdsSubmissionParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const raw = body as Record<string, unknown>;

  // `site_id` is genuinely optional — `lds_status.site_id` is nullable
  // because a dive shop isn't necessarily co-located with a documented dive
  // site (0001_init.sql). Absent, null, and empty-string all mean the same
  // thing here: no linked site.
  let siteId: string | null = null;
  if (raw.site_id !== undefined && raw.site_id !== null && raw.site_id !== "") {
    if (typeof raw.site_id !== "string" || !UUID_PATTERN.test(raw.site_id)) {
      return { ok: false, error: "site_id must be a UUID when provided." };
    }
    siteId = raw.site_id;
  }

  if (typeof raw.name !== "string") {
    return { ok: false, error: "A shop name is required." };
  }
  const name = raw.name.trim();
  if (name.length === 0) {
    return { ok: false, error: "A shop name is required." };
  }
  if (name.length > MAX_SHOP_NAME_LENGTH) {
    return { ok: false, error: `Shop name must be ${MAX_SHOP_NAME_LENGTH} characters or fewer.` };
  }

  // Mirrors `lds_status`' own check constraints (`latitude between -90 and
  // 90`, `longitude between -180 and 180`) so an out-of-range coordinate
  // fails here with a readable message instead of as a database constraint
  // violation. Strings are rejected rather than coerced: this is a write
  // path for data a diver navigates by, and `Number("")` being 0 (a real
  // point in the Gulf of Guinea) is exactly the kind of silent coercion
  // that puts a pin somewhere nobody meant.
  if (typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) || Math.abs(raw.latitude) > 90) {
    return { ok: false, error: "latitude must be a number between -90 and 90." };
  }
  if (typeof raw.longitude !== "number" || !Number.isFinite(raw.longitude) || Math.abs(raw.longitude) > 180) {
    return { ok: false, error: "longitude must be a number between -180 and 180." };
  }

  if (!isStatusValue(raw.status)) {
    return { ok: false, error: `status must be one of: ${LDS_STATUS_VALUES.join(", ")}.` };
  }

  return {
    ok: true,
    value: {
      site_id: siteId,
      name,
      latitude: raw.latitude,
      longitude: raw.longitude,
      status: raw.status,
    },
  };
}

export interface LdsInsertFailure {
  /** HTTP status the route should return. */
  status: number;
  /** Message shown to the submitter — safe to display, no internals. */
  error: string;
  /** Structured-log event name, so each failure class is greppable in
   * production logs rather than collapsing into one generic "insert
   * failed". */
  event: string;
}

/**
 * Maps a PostgREST/Postgres error onto an honest HTTP response.
 *
 * Every case here is a real, reachable failure of this specific insert, not
 * defensive noise:
 *
 * - `P0001` — `enforce_submission_rate_limit()`'s `raise exception`
 *   (`0006_rate_limiting.sql`, 5 rows per user per 10 minutes on
 *   `lds_status`). Postgres reports a bare `raise exception` as `P0001`,
 *   which PostgREST surfaces as a 400; a 429 is the truthful status, and
 *   the trigger's own message already tells the user the limit and that it
 *   resets, so it's passed through verbatim.
 * - `42501` — RLS denial. Should be unreachable (the route only ever writes
 *   `created_by = user.id` and `provenance = 'COMMUNITY'`, which is exactly
 *   what `lds_status_insert_own` permits), so if it ever fires, something
 *   about the session or the policy changed — 403 says that honestly rather
 *   than blaming the server.
 * - `23503` — foreign-key violation, i.e. `site_id` is a well-formed UUID
 *   for a site that doesn't exist (or was deleted between page load and
 *   submit). That's a bad request, not a server fault.
 * - `23514` — check-constraint violation (status/coordinate range). Also
 *   unreachable through `parseLdsSubmissionBody`, kept so a future
 *   constraint added in SQL but not mirrored here degrades to a 400 with a
 *   real message instead of a 500.
 *
 * Anything else is a genuine server-side failure: 500, with a generic
 * message, and the underlying detail goes to the log rather than to the
 * client.
 */
export function classifyLdsInsertFailure(
  code: string | null | undefined,
  message: string | null | undefined,
): LdsInsertFailure {
  switch (code) {
    case "P0001":
      return {
        status: 429,
        error:
          message?.trim() ||
          "You've submitted several reports in a short window — please wait a few minutes and try again.",
        event: "lds_submit.rate_limited",
      };
    case "42501":
      return {
        status: 403,
        error: "Your account isn't allowed to submit this report. Try signing out and back in.",
        event: "lds_submit.rls_denied",
      };
    case "23503":
      return {
        status: 400,
        error: "That dive site no longer exists — reload the page and try again.",
        event: "lds_submit.unknown_site",
      };
    case "23514":
      return {
        status: 400,
        error: "That report was rejected as invalid — reload the page and try again.",
        event: "lds_submit.check_violation",
      };
    default:
      return {
        status: 500,
        error: "Couldn't save your report — try again.",
        event: "lds_submit.insert_failed",
      };
  }
}

/**
 * Parity with the read path's `numeric` handling. PostgREST can serialize
 * Postgres `numeric` columns as JSON strings, which is why every read in
 * this app coerces them (`src/lib/sites/queries.ts`'s `toNumber`, and the
 * identical coercion inside `listLdsStatusMarkers`).
 *
 * Measured 2026-08-20 against the live project: an insert into `lds_status`
 * returning `latitude`/`longitude` came back as JSON **numbers**, not
 * strings — so this is defensive parity with the read path, not a coercion
 * this route is observed to need today. It's kept because the submit route
 * hands its inserted row straight to the client to merge into the very same
 * marker state that read populates: if the serialization ever differs
 * between the two, a `latitude` of `"25.771000"` would reach `distanceMiles`
 * as a string and produce `NaN` miles silently, with no error anywhere.
 */
export function toCoordinateNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}
