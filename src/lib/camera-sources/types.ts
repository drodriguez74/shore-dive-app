/**
 * Shared `camera_sources` row shape (T17.1's schema, `supabase/migrations/
 * 0003_camera_sources.sql`) for the moderation queue UI (T19.2) and the
 * approve/reject route (T19.3). No generated Supabase types exist in this
 * codebase yet — hand-written to match the migration until one is.
 */

export type CameraSourceStatus = "pending_review" | "approved" | "rejected";

export interface CameraSource {
  id: string;
  name: string;
  source_url: string;
  site_id: string | null;
  status: CameraSourceStatus;
  added_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** The only two decisions a reviewer can make — `pending_review` is not a valid target of a review action. */
export type CameraSourceDecision = Extract<CameraSourceStatus, "approved" | "rejected">;

export function isCameraSourceDecision(value: unknown): value is CameraSourceDecision {
  return value === "approved" || value === "rejected";
}
