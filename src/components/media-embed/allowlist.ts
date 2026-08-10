/**
 * Domain allowlist for embedded third-party players (T20.2).
 *
 * THREAT_MODEL.md §9/§10 and plan.md Task 20 are explicit: an embedded
 * third-party player is untrusted content, and it must be restricted to an
 * allowlist of embeddable domains rather than rendering arbitrary embed
 * URLs. This is a deliberately simple, code-level, exported const array —
 * it does not need to be data-driven from `camera_sources` (T17.1) yet.
 *
 * **Decided (T20.2 follow-up): this list stays static and hand-curated,
 * not derived from `camera_sources`.** Two reasons: (1) `isAllowlistedEmbedUrl`
 * is called synchronously in `MediaEmbed`'s render body specifically so a
 * disallowed iframe `src` is never mounted into the DOM even transiently —
 * `MediaEmbed` is a client component, and swapping this for a live Supabase
 * read would make the render-gating check asynchronous, breaking that
 * property. (2) `camera_sources.status = 'approved'` answers "is this a
 * real, permitted camera source," which is a different trust decision than
 * "is this hostname safe to load inside a sandboxed iframe as third-party
 * content" — `camera_sources.source_url` has no format/domain validation at
 * the DB level (see `supabase/migrations/0003_camera_sources.sql`), so
 * auto-deriving the embed allowlist from any approved row would let a
 * moderation mistake on one axis (is this a real camera) silently become a
 * security regression on a different axis (is this domain safe to iframe).
 *
 * The drift-detection gap this leaves — "a `camera_sources` row gets
 * approved with an embeddable-player-shaped URL whose hostname was never
 * added here" — is closed separately, not by automating this file:
 * `src/lib/camera-sources/embed-allowlist-consistency.ts` flags (never
 * auto-resolves) any approved `camera_sources` row that looks like it needs
 * an allowlist entry it doesn't have, callable via
 * `src/app/api/admin/embed-allowlist-consistency/route.ts`. See that file's
 * header comment for the full reasoning and supabase/README.md's
 * "Relationship to the media-embed component's own domain allowlist"
 * section for the write-up from the `camera_sources` side.
 *
 * `embed.example.com`/`cams.example.org` are illustrative placeholders on
 * the IANA-reserved `example.com`/`example.org` domains (RFC 2606) — kept
 * deliberately, not removed, because `/media-demo` and
 * `embed-allowlist-consistency.test.ts` both exercise the allowlist logic
 * against them; they're fixtures, not stale TODOs.
 *
 * The two YouTube/Coral-City-Camera entries below are the first *real*
 * domains added here (2026-08-08) — not speculative, and not from Task 19's
 * discovery pipeline (still correctly inert, see its own header comment):
 * the founder named these specific sources directly. Full provenance in
 * `supabase/sources/webcam-sources.md`. Add future real domains the same
 * way: a deliberate, reviewed, one-line addition here, never automatically
 * derived from an approved `camera_sources` row (see the reasoning above).
 */

export const EMBED_DOMAIN_ALLOWLIST: readonly string[] = [
  "embed.example.com",
  "cams.example.org",
  "www.youtube.com",
  "www.coralcitycamera.com",
];

/**
 * Returns true if `url`'s hostname is present in `EMBED_DOMAIN_ALLOWLIST`
 * (exact, case-insensitive match — no wildcard subdomain matching, kept
 * deliberately strict since this list is meant to be short and
 * hand-curated). Malformed URLs are treated as not-allowlisted rather than
 * throwing, since a caller here is deciding whether to render untrusted
 * input, not parsing a value it can assume is well-formed.
 */
export function isAllowlistedEmbedUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return EMBED_DOMAIN_ALLOWLIST.some((allowed) => allowed.toLowerCase() === hostname);
}
