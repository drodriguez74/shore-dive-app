import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import type { CandidateSourceInput, CandidateSubmissionResult, ExtractedCandidate } from "./types";

/**
 * T19.1 -- inserts one extracted candidate into `camera_sources` as
 * `status: 'pending_review'`, through the normal authenticated-user insert
 * path (the `camera_sources_insert_own` RLS policy in
 * `supabase/migrations/0003_camera_sources.sql`), NOT the service-role
 * client (`src/lib/supabase/admin.ts`).
 *
 * This matters: a discovery-agent-submitted candidate is exactly the same
 * trust level as a human's manual submission per the schema's own design
 * (see that migration's header comment -- "candidates land here as
 * 'pending_review' ... whether self-service insert or Task 19's discovery
 * agent"). It must go through the same RLS-checked path a human submitter
 * would, with `added_by` set from the caller's real authenticated session
 * (`auth.uid()`), never a privileged bypass that could let a batch land
 * with a fabricated `added_by` or an already-`approved` status. The
 * service-role client stays reserved for what `admin.ts`/the review route
 * already use it for: the actual approve/reject moderation action, which
 * requires bypassing RLS because no moderator role is modeled yet.
 *
 * Unique-`source_url` violations (`camera_sources_source_url_key`) are an
 * EXPECTED outcome here -- a candidate that was already discovered or
 * submitted before -- not exceptional. Per CLAUDE.md's "network failures
 * are an expected code path" standard, extended to this DB constraint:
 * caught, logged, and reported as `"duplicate"`, never thrown past this
 * boundary.
 */

const UNIQUE_VIOLATION_CODE = "23505"; // Postgres unique_violation

export interface SubmitCandidateDeps {
  /**
   * Injectable, defaults to the real authenticated-session server client
   * (`src/lib/supabase/server.ts`). Lets a caller (or a future test) swap
   * in a stand-in without a live Supabase project, same reasoning as
   * `bundle-verification.ts`'s injectable `SignatureVerifier`.
   */
  getClient?: () => Promise<SupabaseClient>;
}

async function defaultGetClient(): Promise<SupabaseClient> {
  return createServerClient();
}

/**
 * Submits one already-extracted candidate. Never throws for expected
 * outcomes (duplicate URL, not signed in, Supabase not configured, an
 * invalid `suggestedSiteId` that fails the `sites` foreign key) -- all of
 * those are reported via `CandidateSubmissionResult.status`/`.error` so a
 * batch runner (`run-discovery.ts`) can continue past one bad candidate
 * without aborting. Can throw only for genuinely unexpected setup
 * failures the caller should not attempt to interpret per-candidate (there
 * are none as written below -- every reachable failure is caught -- but
 * the signature stays honest about the possibility, matching
 * `verifyBundleIntegrity`'s "a thrown check is caught, not propagated"
 * philosophy).
 */
export async function submitCandidate(
  input: CandidateSourceInput,
  extracted: ExtractedCandidate,
  deps: SubmitCandidateDeps = {},
): Promise<CandidateSubmissionResult> {
  const getClient = deps.getClient ?? defaultGetClient;

  let supabase: SupabaseClient;
  try {
    supabase = await getClient();
  } catch (error) {
    logger.error("submit.client_init_failed", {
      url: extracted.sourceUrl,
      error: errorMessage(error),
    });
    return {
      status: "failed",
      input,
      extracted,
      error: "Could not set up a Supabase client. Supabase may not be configured yet (copy .env.local.example).",
    };
  }

  let userId: string;
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      logger.warn("submit.not_authenticated", { url: extracted.sourceUrl });
      return {
        status: "failed",
        input,
        extracted,
        error: "Sign-in required to submit a webcam candidate.",
      };
    }
    userId = user.id;
  } catch (error) {
    logger.error("submit.auth_check_failed", {
      url: extracted.sourceUrl,
      error: errorMessage(error),
    });
    return {
      status: "failed",
      input,
      extracted,
      error: "Could not verify sign-in status.",
    };
  }

  try {
    const { data, error } = await supabase
      .from("camera_sources")
      .insert({
        name: extracted.name,
        source_url: extracted.sourceUrl,
        site_id: extracted.siteId,
        status: "pending_review",
        added_by: userId,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION_CODE) {
        logger.info("submit.duplicate", { url: extracted.sourceUrl });
        return { status: "duplicate", input, extracted };
      }
      logger.error("submit.insert_failed", {
        url: extracted.sourceUrl,
        message: error.message,
        code: error.code,
      });
      return { status: "failed", input, extracted, error: error.message };
    }

    const cameraSourceId = (data as { id?: string } | null)?.id;
    logger.info("submit.inserted", { url: extracted.sourceUrl, id: cameraSourceId });
    return { status: "inserted", input, extracted, cameraSourceId };
  } catch (error) {
    logger.error("submit.unexpected_error", {
      url: extracted.sourceUrl,
      error: errorMessage(error),
    });
    return {
      status: "failed",
      input,
      extracted,
      error: error instanceof Error ? error.message : "Unexpected error submitting candidate.",
    };
  }
}
