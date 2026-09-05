import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { classifyLdsInsertFailure, parseLdsSubmissionBody, toCoordinateNumber } from "@/lib/lds/submission";
import { LDS_STATUS_COLUMNS } from "@/lib/sites/queries";
import type { LdsStatusRow } from "@/components/lds/lds-status";

/**
 * Real community LDS/fill-station status submission (Task 16 — closes the
 * gap `plan.md`'s v5 addendum named outright: "LDS status reports currently
 * claim to reach other divers but are localStorage-only, reaching no one").
 *
 * Until this route existed, `LdsSubmissionForm` called a `localStorage`
 * stand-in (`src/components/lds/lds-submissions-store.ts`, deleted with this
 * change) written back when there was no live Supabase project. There has
 * been one for weeks, so the report a diver believed they were filing for
 * other divers never left their own browser — a real instance of CLAUDE.md's
 * "never let a UI imply a guarantee the system can't back." This inserts
 * into the actual `lds_status` table.
 *
 * PROVENANCE — the two values a submitter must never control:
 *   - `created_by` always comes from the authenticated session (`user.id`),
 *     never the request body. Same reasoning `src/app/api/dive-plans/route.ts`
 *     gives for `user_id`: RLS would catch a spoofed value anyway, but not
 *     trusting client input for an identity field is the correct default
 *     regardless of what the database would reject.
 *   - `provenance` is hardcoded `'COMMUNITY'` here and is not a parseable
 *     field on the request body at all (see `src/lib/lds/submission.ts`'s
 *     header). `lds_status_insert_own`'s `with check (created_by =
 *     auth.uid() and provenance = 'COMMUNITY')` (`0002_rls.sql`) is the real
 *     enforcement point; this route is written so it can't even attempt the
 *     other value. The form has never offered a `VERIFIED` option and still
 *     doesn't — a shop owner wanting `VERIFIED` goes through the manual
 *     claim process (`src/components/lds/claim-listing.tsx`), which is a
 *     founder-run SQL path, not a self-service write.
 *
 * Signed-in only (401 otherwise). That isn't a product preference — the RLS
 * policy above is granted `to authenticated`, so an anonymous insert cannot
 * succeed; failing fast with an honest 401 beats a confusing RLS error, and
 * the form itself now shows a sign-in prompt instead of letting someone fill
 * out a report they can't file (`lds-submission-form.tsx`).
 *
 * Writes through the caller's own server client rather than the service-role
 * client — deliberately, exactly like `/api/sites/candidates/add` — so both
 * RLS and the 5-per-10-minutes rate-limit trigger (`0006_rate_limiting.sql`)
 * apply to this path as they do to any other self-service submission.
 *
 * Shape/conventions mirror `src/app/api/dive-plans/route.ts`:
 * `NextRequest`/`NextResponse`, JSON parsing in its own try/catch with a 400,
 * validation before any I/O, structured logging via `@/lib/sites/logger`, and
 * every Supabase call inside try/catch so a network failure is a handled code
 * path rather than an uncaught throw (CLAUDE.md's I/O-boundary standard).
 */

/** The inserted row, in exactly the shape `listLdsStatusMarkers()` returns —
 * so a caller can merge it straight into the marker state that read
 * populated, with no refetch and no shape translation. */
interface LdsSubmitResponse {
  marker: LdsStatusRow;
}

interface RawInsertedRow extends Omit<LdsStatusRow, "latitude" | "longitude"> {
  latitude: number | string;
  longitude: number | string;
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (error) {
    logger.warn("lds_submit.invalid_json_body", { error: errorMessage(error) });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const parsed = parseLdsSubmissionBody(rawBody);
  if (!parsed.ok) {
    logger.warn("lds_submit.invalid_body", { error: parsed.error });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const submission = parsed.value;

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Sign in required to report a shop's status." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("lds_status")
      .insert({
        site_id: submission.site_id,
        name: submission.name,
        latitude: submission.latitude,
        longitude: submission.longitude,
        status: submission.status,
        // Never client-suppliable — see the header. `last_verified_at` and
        // `created_at` are deliberately omitted so Postgres' own `now()`
        // defaults stamp them: a submitter can't backdate a report, and
        // `last_verified_at` is precisely what a diver reads to decide
        // whether a fill station's "open" is still worth driving to
        // (THREAT_MODEL.md §8).
        provenance: "COMMUNITY",
        created_by: user.id,
      })
      .select(LDS_STATUS_COLUMNS)
      .single<RawInsertedRow>();

    if (error) {
      const failure = classifyLdsInsertFailure(error.code, error.message);
      logger.warn(failure.event, {
        userId: user.id,
        shopName: submission.name,
        siteId: submission.site_id,
        code: error.code,
        error: error.message,
      });
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    // `.single()` only resolves without an error when exactly one row came
    // back, so this is belt-and-braces — but returning a fabricated/partial
    // marker to be merged into the map would be worse than an honest 500.
    if (!data) {
      logger.error("lds_submit.insert_returned_no_row", { userId: user.id, shopName: submission.name });
      return NextResponse.json({ error: "Couldn't save your report — try again." }, { status: 500 });
    }

    const marker: LdsStatusRow = {
      ...data,
      latitude: toCoordinateNumber(data.latitude),
      longitude: toCoordinateNumber(data.longitude),
    };

    logger.info("lds_submit.inserted", {
      userId: user.id,
      rowId: marker.id,
      siteId: marker.site_id,
      shopName: marker.name,
      status: marker.status,
    });

    return NextResponse.json({ marker } satisfies LdsSubmitResponse, { status: 201 });
  } catch (error) {
    // Reaches here only for a thrown failure rather than a returned
    // PostgREST error: a missing-env-var throw from `createServerClient()`,
    // a network/DNS failure, or an `auth.getUser()` transport error.
    logger.error("lds_submit.failed", {
      shopName: submission.name,
      siteId: submission.site_id,
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Couldn't save your report — try again." }, { status: 500 });
  }
}
