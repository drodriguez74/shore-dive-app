/**
 * T20.2 follow-up — consistency check between `camera_sources` (T17.1) and
 * the media-embed component's static `EMBED_DOMAIN_ALLOWLIST`
 * (`src/components/media-embed/allowlist.ts`).
 *
 * ## The decision this file implements
 *
 * `allowlist.ts`'s header comment used to defer a design question: should
 * `EMBED_DOMAIN_ALLOWLIST` be derived automatically from approved
 * `camera_sources.source_url` hostnames instead of hand-curated? The answer,
 * decided here, is **no** — the allowlist stays a static, hand-curated,
 * synchronous array. Two reasons, one structural and one about risk:
 *
 * 1. **Structural**: `isAllowlistedEmbedUrl()` is called synchronously in
 *    `MediaEmbed`'s render body (`media-embed.tsx`), deliberately — the
 *    inline comment there explains this is so a disallowed iframe `src`
 *    is never mounted into the DOM even transiently, not even for one
 *    paint. `MediaEmbed` is a client component. Replacing the static array
 *    with a live DB read would make that check asynchronous (a network
 *    round trip to Supabase), which breaks the "never mount, not even
 *    briefly" property the render-time check exists for, and would need
 *    every call site to handle a loading state before the security gate
 *    even resolves. That's a real regression, not a neutral refactor.
 * 2. **Risk**: `camera_sources.source_url` has no format/domain validation
 *    at the DB level (see `supabase/migrations/0003_camera_sources.sql`'s
 *    column comment) — validation is deferred to T17.2's ingestion
 *    connector and to this allowlist. `camera_sources.status = 'approved'`
 *    answers "is this a real, permitted camera source"; it says nothing
 *    about "is this hostname safe to load inside a sandboxed iframe as
 *    third-party content" (THREAT_MODEL.md §9/§10) — those are two
 *    independent trust decisions. If a future `camera_sources` row is
 *    approved with an embeddable-player-shaped `source_url` on an
 *    untrusted domain (human moderator error, or eventually T19's
 *    discovery agent feeding the queue), auto-deriving the embed allowlist
 *    from "any approved row" would silently expand what iframes the app
 *    is willing to render — turning a moderation mistake on one axis into
 *    a security regression on a different one.
 *
 * ## What this file does instead
 *
 * Closes the "two independent allowlists can silently drift apart" gap
 * with a **detection**, not automation: `findEmbedAllowlistDrift()` is a
 * pure function that flags any *approved* `camera_sources` row whose
 * `source_url` looks like it would be rendered by the embed tier (i.e.
 * doesn't look like a raw stream/still-image URL — see
 * `looksLikeEmbeddablePlayerUrl()` below) but whose hostname is NOT on
 * `EMBED_DOMAIN_ALLOWLIST`. That's a real gap a human needs to resolve —
 * either add the hostname to the static allowlist (a deliberate,
 * reviewed, code-level change) or reject/re-review the camera_sources row
 * — never something this check resolves on its own. Fails toward "flag
 * for a human," never toward "silently widen the allowlist."
 *
 * `checkApprovedCameraSourcesEmbedAllowlist()` is the server-side wrapper
 * that actually queries Supabase; it's the thing the route handler at
 * `src/app/api/admin/embed-allowlist-consistency/route.ts` calls (GET-able
 * manual/cron trigger, mirroring the "no guaranteed background execution
 * on the web, always pair automation with a manual path" philosophy
 * already used for `src/app/api/cron/webcam-extraction/route.ts` and the
 * Task 12 "Prefetch Now" button). `findEmbedAllowlistDrift()` itself is
 * plain data-in/data-out logic with no I/O, so it stays usable without a
 * live Supabase project (there is no test runner configured in this repo
 * yet — see CLAUDE.md's Commands section — so this is deliberately
 * structured so a future `npm test` can exercise the pure function
 * directly without needing DB fixtures or a running Supabase instance).
 *
 * See `supabase/README.md`'s "Relationship to the media-embed component's
 * own domain allowlist" section for the same decision written up from the
 * `camera_sources` side.
 */

import { EMBED_DOMAIN_ALLOWLIST, isAllowlistedEmbedUrl } from "@/components/media-embed/allowlist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CameraSource } from "./types";
import { logger } from "./logger";

// Extensions that indicate a URL is a raw playable stream or still image —
// the `streamUrl`/`stillImageUrl` tiers in the media-embed fallback chain,
// neither of which is ever mounted in an iframe and so neither is subject
// to `EMBED_DOMAIN_ALLOWLIST` at all (see media-embed.tsx's `buildTierOrder`
// and `looksLikeHls`, which this list deliberately mirrors and extends).
// `camera_sources` has no explicit column distinguishing "raw stream" from
// "embeddable player page" yet (see the migration's `source_url` comment) —
// this is a conservative, extension-based heuristic standing in for that
// until T17.2's ingestion connector adds real tier classification. It is
// deliberately conservative in the safe direction: a URL this heuristic
// can't confidently call "raw media" is treated as embeddable-player-shaped
// and therefore held to the allowlist requirement, rather than the reverse.
const RAW_MEDIA_EXTENSIONS = [
  ".m3u8", // HLS playlist
  ".mp4",
  ".mov",
  ".webm",
  ".ts", // MPEG-TS segment
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
];

/**
 * Returns true if `url` looks like it would be routed to the media-embed
 * component's "embed" tier (a third-party player page rendered in a
 * sandboxed iframe) rather than the "stream" or "still" tiers (a direct
 * `<video>`/`<img>` src, never iframed, never subject to
 * `EMBED_DOMAIN_ALLOWLIST`). A malformed URL is treated as
 * embeddable-player-shaped — same "fail toward requiring the allowlist
 * check" reasoning as the extension list above.
 */
export function looksLikeEmbeddablePlayerUrl(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return true;
  }
  const looksLikeRawMedia = RAW_MEDIA_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  return !looksLikeRawMedia;
}

export interface EmbedAllowlistDriftEntry {
  id: string;
  name: string;
  source_url: string;
  /** null when `source_url` itself doesn't parse as a URL. */
  hostname: string | null;
}

/**
 * Pure, DB-independent check: given a set of already-`approved`
 * `camera_sources` rows, returns the ones whose `source_url` looks
 * embeddable-player-shaped but whose hostname is missing from
 * `EMBED_DOMAIN_ALLOWLIST`. An empty array means the two allowlists are
 * consistent as far as this heuristic can tell.
 *
 * Deliberately does NOT filter by `status` itself — callers are expected
 * to pass only rows they already know are `approved` (the caller in this
 * file does; a caller reusing this against pending/rejected rows would be
 * a caller bug, not something this function should silently paper over by
 * re-deciding what "approved" means).
 */
export function findEmbedAllowlistDrift(
  approvedSources: readonly Pick<CameraSource, "id" | "name" | "source_url">[],
): EmbedAllowlistDriftEntry[] {
  const drift: EmbedAllowlistDriftEntry[] = [];

  for (const source of approvedSources) {
    if (!looksLikeEmbeddablePlayerUrl(source.source_url)) continue;
    if (isAllowlistedEmbedUrl(source.source_url)) continue;

    let hostname: string | null;
    try {
      hostname = new URL(source.source_url).hostname.toLowerCase();
    } catch {
      hostname = null;
    }

    drift.push({ id: source.id, name: source.name, source_url: source.source_url, hostname });
  }

  return drift;
}

/**
 * Server-side wrapper: queries every `approved` `camera_sources` row and
 * runs `findEmbedAllowlistDrift()` against them. Uses the service-role
 * admin client (`src/lib/supabase/admin.ts`) purely for read simplicity —
 * this is a read-only maintenance/ops check with no user-session
 * dependency, not a write path, so bypassing RLS here doesn't create the
 * kind of unmoderated-write risk CLAUDE.md warns about (approved rows are
 * public-readable via RLS's `camera_sources_select_approved` policy
 * anyway; using the admin client just avoids needing a cookie-bound
 * session for what is effectively a cron/CLI-shaped caller).
 *
 * Throws on a Supabase query failure (including "not configured yet" —
 * no real Supabase project exists as of this writing) rather than
 * returning a false "no drift found" — a failed check must never be
 * silently read as "everything's fine," matching this file's
 * fail-toward-a-human-flag philosophy.
 */
export async function checkApprovedCameraSourcesEmbedAllowlist(): Promise<EmbedAllowlistDriftEntry[]> {
  const admin = createAdminClient();

  const { data, error } = await admin.from("camera_sources").select("id, name, source_url").eq("status", "approved");

  if (error) {
    logger.error("embed-allowlist-consistency.query_failed", {
      message: error.message,
      code: error.code,
    });
    throw new Error(`Failed to query approved camera_sources: ${error.message}`);
  }

  const drift = findEmbedAllowlistDrift(data ?? []);

  if (drift.length > 0) {
    logger.warn("embed-allowlist-consistency.drift_found", {
      count: drift.length,
      allowlistSize: EMBED_DOMAIN_ALLOWLIST.length,
      hostnames: drift.map((entry) => entry.hostname),
    });
  } else {
    logger.info("embed-allowlist-consistency.no_drift", { checked: data?.length ?? 0 });
  }

  return drift;
}
