/**
 * Shared types for the webcam candidate-discovery workflow (T19.1).
 *
 * Read `discover-candidates.ts`'s header before wiring this feature up to
 * anything else -- it documents the hard "no live/autonomous web
 * discovery" boundary this feature cluster operates under per
 * THREAT_MODEL.md §9 and the founder's session-scoped decision to ship
 * T19.1 as scaffolding only.
 */

/**
 * Raw, minimally-structured input describing one candidate camera to
 * consider. This is deliberately loose -- it's what a founder-curated seed
 * list entry or a manually-submitted batch looks like before the
 * extraction step (`extract-candidate.ts`) normalizes it.
 */
export interface CandidateSourceInput {
  /** The camera stream/embed URL itself. Same loosely-typed field as `camera_sources.source_url` (see 0003_camera_sources.sql) -- format validation happens in `extract-candidate.ts`, not here. */
  url: string;
  /** Free-text context about the candidate (e.g. where/how it was found, a page title, a description a curator supplied). Fed to the LLM extraction step as untrusted context, never treated as already-structured data. */
  contextText?: string;
  /** Optional site association a human curator/submitter suggests. Not validated against `sites` in this layer -- `extract-candidate.ts`/`submit-candidate.ts` pass it through as-is; the DB foreign key (`camera_sources.site_id references sites(id) on delete set null`) is the real validation boundary, and an invalid id simply fails the insert. */
  suggestedSiteId?: string;
}

/**
 * Normalized output of the LLM extraction step (`extract-candidate.ts`),
 * shaped to insert directly into `camera_sources` (via `submit-candidate.ts`).
 */
export interface ExtractedCandidate {
  name: string;
  sourceUrl: string;
  siteId: string | null;
  /**
   * 0-1 confidence the extraction step has that this is a genuine,
   * distinct, working camera source worth a human reviewer's time. Not
   * stored on `camera_sources` (no confidence column there -- that table's
   * schema doesn't carry a confidence field the way `webcam_readings`
   * does for T18's vision estimates) -- surfaced only in logs/UI so a
   * low-confidence batch is legible before it lands in the moderation
   * queue, never used to auto-filter or auto-decide anything.
   */
  confidence: number;
}

/** Outcome of attempting to submit one extracted candidate to `camera_sources`. */
export type CandidateSubmissionStatus = "inserted" | "duplicate" | "failed";

export interface CandidateSubmissionResult {
  status: CandidateSubmissionStatus;
  input: CandidateSourceInput;
  extracted?: ExtractedCandidate;
  /** The inserted row's id, populated only when `status` is `"inserted"`. */
  cameraSourceId?: string;
  /** Populated only when `status` is `"failed"`. */
  error?: string;
}
