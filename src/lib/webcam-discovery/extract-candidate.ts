import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";
import type { CandidateSourceInput, ExtractedCandidate } from "./types";

/**
 * T19.1 -- LLM-assisted normalization of one raw candidate camera source
 * (a URL plus optional free-text context) into a shape ready to insert
 * into `camera_sources`.
 *
 * HONEST STATUS: this is real, type-checked integration code written
 * against the official `@anthropic-ai/sdk`, not a mock. It will genuinely
 * call the Anthropic API and produce a real result -- *if* given a real
 * `ANTHROPIC_API_KEY`. No such key is configured in any environment yet,
 * and this function has never been exercised against the live API. Same
 * "real code, no live credentials" pattern as
 * `webcam-extraction/vision-client.ts`: `getClient()` below throws a
 * clear, actionable error if the key is missing, rather than silently
 * no-opping or fabricating a result.
 *
 * Text-only extraction -- normalizing a URL + free-text context needs no
 * vision -- so this reuses the same cheap/fast model
 * `webcam-extraction/model.ts` already settled on for this codebase's
 * AI-backed workers (`claude-haiku-4-5-20251001`, the cheapest current
 * vision-capable Claude model at the time that file was written, and
 * perfectly adequate for plain-text normalization too). See that file's
 * header for the full founder-cost-flag reasoning (the Anthropic API has
 * no free tier at all) -- the same caveat applies here, and the same
 * "reconfirm this is still the cheapest option before enabling against
 * real spend" note holds.
 *
 * Unlike Task 18's scheduled worker (`run-extraction.ts`, gated behind
 * `WEBCAM_EXTRACTION_ENABLED` + a daily call cap because a misfiring cron
 * schedule could otherwise run unboundedly), this module does not add its
 * own separate enable-flag or rate cap: nothing in this feature runs
 * autonomously. `discover-candidates.ts`'s default only returns an
 * (empty-by-default) founder-curated seed list, and this extraction step
 * only ever executes from an explicit manual trigger (the
 * `/api/webcam-discovery` route, capped at a small batch size per
 * request -- see that route's header) -- there is no scheduled job that
 * could rack up unbounded spend on its own.
 */

const MODEL_ID = "claude-haiku-4-5-20251001";

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    name: {
      description:
        'A short, human-readable name for this camera source, suitable for display in a moderation queue and (once approved) to end users. Derive it from the URL and/or contextText -- e.g. a municipal beach cam\'s title, a dive shop\'s name. If nothing usable is present, produce a generic-but-honest name like "Unnamed webcam candidate" rather than inventing specifics not supported by the input.',
      type: "string",
    },
    normalized_url: {
      description:
        "The candidate's source URL, normalized (trimmed, obviously-malformed whitespace/tracking-fragment noise removed) but NOT changed in meaning -- do not guess at or substitute a different URL than the one given.",
      type: "string",
    },
    confidence: {
      description:
        "Overall confidence, from 0 (no confidence this is a genuine, distinct, working camera source worth a human reviewer's time) to 1 (very confident). Be honest and conservative -- a bare or ambiguous URL with little supporting context should score low, not be presented with false certainty. This only affects triage ordering in a human-review queue, never an automatic publish/reject decision, but overconfidence here still wastes a reviewer's time.",
      type: "number",
    },
  },
  required: ["name", "normalized_url", "confidence"],
  additionalProperties: false,
} as const;

const EXTRACTION_PROMPT = `You are helping normalize a single candidate webcam source before a human reviews it for a shore-dive-site camera allowlist. Given a raw URL and optional free-text context about where it was found, produce:

- name: a short, human-readable name for the source
- normalized_url: the URL, cleaned up but not changed in meaning
- confidence: your honest 0-1 confidence this is a genuine, distinct, working camera source worth a reviewer's time

Candidate URL: {{url}}
Context (may be empty): {{contextText}}

Respond with exactly the requested JSON shape, nothing else. This candidate lands in a human moderation queue regardless of your output -- it is never auto-published -- so focus on accurate normalization, not on deciding whether the source is legitimate.`;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The webcam candidate-discovery workflow (Task 19.1) cannot call the " +
        "extraction model without it. This is expected in every environment today -- no key has been " +
        "provisioned yet. Refusing to proceed rather than silently skipping the call.",
    );
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

interface RawExtraction {
  name?: unknown;
  normalized_url?: unknown;
  confidence?: unknown;
}

/**
 * Validates and clamps the raw model output -- same "don't trust a field
 * just because it came from a structured response" discipline as
 * `webcam-extraction/shape-reading.ts`. Kept as a separate, pure function
 * so it's testable without the Anthropic SDK. Throws if the normalized URL
 * isn't even parseable as a URL -- a candidate this malformed can't
 * usefully reach `camera_sources.source_url`, and the caller
 * (`run-discovery.ts`) is expected to catch this per-candidate, the same
 * as any other extraction failure.
 */
export function shapeExtraction(raw: RawExtraction, input: CandidateSourceInput): ExtractedCandidate {
  const name =
    typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : "Unnamed webcam candidate";

  const candidateUrl =
    typeof raw.normalized_url === "string" && raw.normalized_url.trim().length > 0
      ? raw.normalized_url.trim()
      : input.url.trim();

  // Basic sanity check only -- `camera_sources.source_url` is deliberately
  // not format-validated at the DB level beyond not-null (see
  // 0003_camera_sources.sql's comment on that column), but a value that
  // doesn't even parse as a URL is not a usable candidate.
  try {
    new URL(candidateUrl);
  } catch {
    throw new Error(`Candidate URL "${candidateUrl}" (from input "${input.url}") is not a valid URL`);
  }

  const rawConfidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;

  return {
    name,
    sourceUrl: candidateUrl,
    siteId: input.suggestedSiteId ?? null,
    confidence,
  };
}

/**
 * Calls the extraction model on one raw candidate and returns a
 * normalized, insert-ready shape. Throws on any failure (missing API key,
 * network error, non-2xx, unparseable response, or an unusably malformed
 * URL) -- callers (`run-discovery.ts`) are expected to catch per-candidate
 * and continue to the next one, exactly like `run-extraction.ts`'s
 * per-camera failure isolation for Task 18.
 */
export async function extractCandidate(input: CandidateSourceInput): Promise<ExtractedCandidate> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 512,
    output_config: {
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT.replace("{{url}}", input.url).replace(
          "{{contextText}}",
          input.contextText && input.contextText.trim().length > 0 ? input.contextText : "(none provided)",
        ),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    logger.error("extraction-refused", { url: input.url });
    throw new Error(`Extraction model refused to process candidate "${input.url}"`);
  }

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock) {
    logger.error("extraction-no-text-block", { url: input.url, stopReason: response.stop_reason });
    throw new Error(`Extraction model response for candidate "${input.url}" contained no text content`);
  }

  let parsed: RawExtraction;
  try {
    parsed = JSON.parse(textBlock.text) as RawExtraction;
  } catch (error) {
    logger.error("extraction-unparseable-response", {
      url: input.url,
      error: error instanceof Error ? error.message : error,
    });
    throw new Error(`Extraction model response for candidate "${input.url}" was not valid JSON`);
  }

  return shapeExtraction(parsed, input);
}
