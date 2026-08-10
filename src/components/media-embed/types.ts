/**
 * Prop types for the unified media embed component (T20.1).
 *
 * plan.md Task 20 / TASKS.md T20.1: "Media component with fallback order:
 * live stream → embedded player → refreshing stills." This file describes
 * that contract independent of where the data comes from — there's no live
 * `camera_sources` table data to build against yet (T17.1 just created the
 * schema, T17.2 hasn't shipped an ingestion connector), so this is a clean
 * props interface a future connector/query can populate, not something
 * wired to Supabase.
 */

/** A single camera's available media sources, in priority order. */
export interface MediaEmbedSource {
  /** Human-readable label for this camera — used in fallback copy, the
   * sandboxed iframe's `title` attribute, and structured log fields. */
  label: string;
  /**
   * Direct, playable video URL — an HLS (`.m3u8`) endpoint or a standard
   * `<video>`-compatible file/stream URL. Tried first per the fallback
   * order. Optional: not every camera exposes a raw playable stream.
   */
  streamUrl?: string;
  /**
   * A third-party embeddable player page (e.g. a dive shop's or municipal
   * park service's own embed widget). Tried if `streamUrl` is absent or
   * fails. Rendered inside a sandboxed iframe (T20.2) — refused entirely,
   * with a visible message, if the URL's hostname isn't in
   * `EMBED_DOMAIN_ALLOWLIST` (see `./allowlist`).
   */
  embedUrl?: string;
  /**
   * A still-image URL, refreshed on an interval via a cache-busting query
   * param. Last-resort fallback per the fallback order. Optional.
   */
  stillImageUrl?: string;
  /**
   * How often to re-fetch `stillImageUrl`, in seconds. Defaults to 60 (see
   * `DEFAULT_STILL_REFRESH_SECONDS` in `./media-embed`) if omitted.
   */
  stillRefreshIntervalSeconds?: number;
}

export interface MediaEmbedProps {
  source: MediaEmbedSource;
  className?: string;
}

/** The fallback tier currently being attempted/shown. `unavailable` is the
 * terminal state once every tier with a configured URL has failed (or none
 * were configured at all). */
export type MediaEmbedTier = "stream" | "embed" | "still" | "unavailable";
