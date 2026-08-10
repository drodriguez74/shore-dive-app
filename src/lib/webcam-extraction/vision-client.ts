import Anthropic from "@anthropic-ai/sdk";
import { CHOP_STATES } from "./types";
import { WEBCAM_EXTRACTION_MODEL_ID } from "./model";
import { logger } from "./logger";
import type { RawModelOutput } from "./shape-reading";

/**
 * T18.1/T18.2 — the actual Anthropic API call. Read `model.ts`'s header
 * first (the founder-cost-flag this file's model choice depends on).
 *
 * HONEST STATUS: this is real, type-checked integration code written
 * against the official `@anthropic-ai/sdk`, not a mock. It will genuinely
 * call the Anthropic API and produce a real result — *if* given a real
 * `ANTHROPIC_API_KEY`. But no such key is configured in any environment
 * yet, and this function has never been exercised against a live camera
 * source (T17.2 also not done — see `snapshot-fetch.ts`). Same "real code,
 * no live credentials" pattern as `bundle-signing.ts`/`bundle-
 * verification.ts`'s default `SignatureVerifier`: `getClient()` below
 * throws a clear, actionable error if the key is missing, rather than
 * silently no-opping or fabricating a result — a clean `tsc`/build here
 * proves the request/response shape compiles against the real SDK, not
 * that this has been run against the live API even once.
 */

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    visibility_meters: {
      description:
        "Estimated horizontal underwater visibility in meters, based on how far into the water clarity can be judged from the surface. Use null if the frame gives no basis for a visibility estimate (e.g. camera not aimed at water, too dark, obstructed).",
      anyOf: [{ type: "number" }, { type: "null" }],
    },
    chop_state: {
      description:
        "Categorical sea-state/chop estimate for the visible water surface. Use null if the frame gives no basis for a chop estimate.",
      anyOf: [{ type: "string", enum: [...CHOP_STATES] }, { type: "null" }],
    },
    confidence: {
      description: "Overall confidence in this extraction, from 0 (no confidence / pure guess) to 1 (very confident).",
      type: "number",
    },
  },
  required: ["visibility_meters", "chop_state", "confidence"],
  additionalProperties: false,
} as const;

const EXTRACTION_PROMPT = `You are looking at a single still frame from a public shore-dive webcam named "{{cameraName}}". Estimate current water conditions relevant to a diver's go/no-go decision:

- visibility_meters: your best estimate of horizontal underwater visibility, in meters, judged from surface clarity/color/turbidity cues visible in the frame. Use null if the frame doesn't give you a reasonable basis for this (e.g. the camera isn't pointed at water, it's too dark, the view is obstructed).
- chop_state: one of calm, light, moderate, rough, severe, describing visible surface chop/wave action. Use null if you can't tell.
- confidence: your overall confidence in this extraction as a single 0-1 number. Be honest and conservative — a fogged lens, glare, poor framing, or an image that doesn't clearly show open water should produce a LOW confidence score, not a guessed value presented with false certainty. This estimate may factor into a diver's real safety decision, so do not overstate certainty.

Respond with exactly the requested JSON shape, nothing else.`;

export interface VisionExtractionInput {
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  cameraName: string;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The Visual Telemetry Extraction Pipeline (Task 18) cannot call the " +
        "vision model without it. This is expected in every environment today — no key has been " +
        "provisioned yet (see model.ts's founder-confirmation note on enabling real API spend). " +
        "Refusing to proceed rather than silently skipping the call.",
    );
  }
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/**
 * Calls the vision model on a single webcam snapshot and returns its raw
 * (still-untrusted) JSON response. Callers MUST run the result through
 * `shapeReading()` (`shape-reading.ts`) before treating any field as
 * trustworthy — `output_config.format` constrains the response's shape,
 * not its semantic correctness (see that file's header for why).
 *
 * Throws on any API failure (missing key, network error, non-2xx, a
 * response with no parseable text block) — callers (`run-extraction.ts`)
 * are expected to catch per-camera and continue to the next source rather
 * than let one failure abort the whole run, exactly like
 * `verifyBundleIntegrity`'s "a thrown verifier is caught, not propagated"
 * shape.
 */
export async function extractVisibilityAndChop(input: VisionExtractionInput): Promise<RawModelOutput> {
  const client = getClient();

  const response = await client.messages.create({
    model: WEBCAM_EXTRACTION_MODEL_ID,
    max_tokens: 512,
    output_config: {
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: input.imageMediaType, data: input.imageBase64 },
          },
          {
            type: "text",
            text: EXTRACTION_PROMPT.replace("{{cameraName}}", input.cameraName),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    logger.error("vision-call-refused", { cameraName: input.cameraName });
    throw new Error(`Vision model refused the extraction request for camera "${input.cameraName}"`);
  }

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
  if (!textBlock) {
    logger.error("vision-call-no-text-block", { cameraName: input.cameraName, stopReason: response.stop_reason });
    throw new Error(`Vision model response for camera "${input.cameraName}" contained no text content`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    logger.error("vision-call-unparseable-response", {
      cameraName: input.cameraName,
      error: error instanceof Error ? error.message : error,
    });
    throw new Error(`Vision model response for camera "${input.cameraName}" was not valid JSON`);
  }

  // Deliberately NOT validated/clamped here — that's shape-reading.ts's
  // job (kept separate so it stays pure and unit-testable without the
  // Anthropic SDK). This function's contract ends at "produced parseable
  // JSON from the API," not "produced trustworthy field values."
  return parsed as RawModelOutput;
}
