"use client";

/**
 * Unified media embed & fallback UI (T20.1–T20.3).
 *
 * Fallback order per plan.md Task 20 / TASKS.md T20.1: live stream →
 * embedded player → refreshing stills, falling through to a final
 * "unavailable" state if every configured tier fails. There's no live
 * `camera_sources` data yet (T17.1 just landed the schema; T17.2's
 * ingestion connector doesn't exist), so this is built against the clean
 * `MediaEmbedSource` props contract in `./types`, not against real data —
 * see `src/app/media-demo/page.tsx` for a mock-data usage.
 *
 * The embedded-player tier treats its source as fully untrusted per
 * THREAT_MODEL.md §9/§10: rendered only inside a sandboxed iframe, only if
 * the URL's hostname is in `EMBED_DOMAIN_ALLOWLIST` (`./allowlist`), and
 * with no shared cookie/session/app-auth context whatsoever — see the
 * inline comments on the `sandbox` attribute below for why each permission
 * included (or deliberately omitted) is there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAllowlistedEmbedUrl } from "./allowlist";
import { logger } from "./logger";
import type { MediaEmbedProps } from "./types";

export const DEFAULT_STILL_REFRESH_SECONDS = 60;

// How long to wait for the sandboxed embed iframe to fire `onLoad` before
// treating it as failed and advancing to the next fallback tier. Cross-origin
// iframes don't reliably fire `onerror` for a remote-side failure (blocked
// by the far end, DNS failure, provider outage, etc.) — a load timeout is
// the practical failure signal here; `onError` is handled too in case the
// browser does surface a local one (e.g. a network-level error).
const EMBED_LOAD_TIMEOUT_MS = 8_000;

type TierEntry = { tier: "stream" | "embed" | "still"; url: string };

function buildTierOrder(source: MediaEmbedProps["source"]): TierEntry[] {
  const tiers: TierEntry[] = [];
  if (source.streamUrl) tiers.push({ tier: "stream", url: source.streamUrl });
  if (source.embedUrl) tiers.push({ tier: "embed", url: source.embedUrl });
  if (source.stillImageUrl) tiers.push({ tier: "still", url: source.stillImageUrl });
  return tiers;
}

function looksLikeHls(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
}

// There's no bundled HLS.js (or any new package — out of scope per this
// task's constraints) in this repo, so `.m3u8` playback relies entirely on
// a browser's native HLS support (in practice: Safari/iOS). This check lets
// an unsupported browser skip straight past a doomed load attempt instead
// of stalling on a stream tier that was never going to work, rather than
// waiting on `onError`/`onStalled` to eventually fire (which some browsers
// are slow or inconsistent about for an unrecognized format).
function canPlayHlsNatively(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("video");
  return probe.canPlayType("application/vnd.apple.mpegurl") !== "";
}

const FAILURE_MESSAGES: Record<string, string> = {
  hls_unsupported: "This browser can't play the live stream format.",
  stream_error: "The live stream failed to load.",
  stream_stalled: "The live stream stalled.",
  embed_domain_not_allowlisted:
    "This embed's domain isn't on the allowlist — refusing to render untrusted content.",
  embed_load_timeout: "The embedded player didn't load in time.",
  embed_error: "The embedded player failed to load.",
  still_error: "The still image failed to load.",
};

/**
 * Public entry point. A thin wrapper around `MediaEmbedInner` that's
 * remounted (via `key`) whenever the underlying source identity changes.
 * This is the idiomatic React fix for "reset all state when a prop
 * changes" (see https://react.dev/learn/you-might-not-need-an-effect) —
 * remounting via `key` resets every piece of tier/failure state for free,
 * rather than needing an effect that watches the source and calls
 * `setTierIndex(0)`/`setLastFailureMessage(null)` itself.
 */
export function MediaEmbed({ source, className = "" }: MediaEmbedProps) {
  const sourceKey = `${source.streamUrl ?? ""}|${source.embedUrl ?? ""}|${source.stillImageUrl ?? ""}`;
  return <MediaEmbedInner key={sourceKey} source={source} className={className} />;
}

function MediaEmbedInner({ source, className = "" }: MediaEmbedProps) {
  const tiers = useMemo(
    () => buildTierOrder(source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source.streamUrl, source.embedUrl, source.stillImageUrl],
  );

  const [tierIndex, setTierIndex] = useState(0);
  const [lastFailureMessage, setLastFailureMessage] = useState<string | null>(null);
  const stillRefreshMs = (source.stillRefreshIntervalSeconds ?? DEFAULT_STILL_REFRESH_SECONDS) * 1000;
  const [stillCacheBust, setStillCacheBust] = useState(() => Date.now());
  const embedLoadedRef = useRef(false);

  const advance = useCallback(
    (reason: string) => {
      const message = FAILURE_MESSAGES[reason] ?? "This source failed.";
      logger.warn("tier_failed", { label: source.label, reason });
      setLastFailureMessage(message);
      setTierIndex((i) => i + 1);
    },
    [source.label],
  );

  const retry = useCallback(() => {
    logger.info("retry", { label: source.label });
    setTierIndex(0);
    setLastFailureMessage(null);
  }, [source.label]);

  const current = tiers[tierIndex];

  // Stream tier: skip up front (rather than attempting a doomed load) if
  // this looks like an HLS URL the current browser can't natively play.
  // `setTimeout(fn, 0)` defers the `advance()` call out of the effect's
  // synchronous body (satisfies react-hooks' set-state-in-effect rule) —
  // functionally still immediate from the user's perspective, just
  // deferred by one macrotask rather than called mid-effect.
  useEffect(() => {
    if (!current || current.tier !== "stream") return;
    if (!looksLikeHls(current.url) || canPlayHlsNatively()) return;
    const timer = setTimeout(() => advance("hls_unsupported"), 0);
    return () => clearTimeout(timer);
  }, [current, advance]);

  // Embed tier bookkeeping: allowlist rejection and the load-timeout
  // failure detector both live here. Note the allowlist check that
  // actually *gates rendering* happens synchronously below in the render
  // path, not in this effect — an effect only runs after commit, which
  // would mean a disallowed iframe src got mounted into the DOM for at
  // least one paint before being torn down. Doing the check in render
  // instead means a disallowed URL is never mounted, not even briefly.
  useEffect(() => {
    if (!current || current.tier !== "embed") return;
    embedLoadedRef.current = false;

    if (!isAllowlistedEmbedUrl(current.url)) {
      // Deferred via setTimeout for the same set-state-in-effect reason as
      // the stream-tier check above — the render path already refused to
      // mount the iframe this pass; this only advances the tier index.
      const timer = setTimeout(() => advance("embed_domain_not_allowlisted"), 0);
      return () => clearTimeout(timer);
    }

    const timeout = setTimeout(() => {
      if (!embedLoadedRef.current) advance("embed_load_timeout");
    }, EMBED_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [current, advance]);

  // Still tier: re-fetch on an interval via a cache-busting query param.
  // The initial cache-bust value comes from the `useState(() => Date.now())`
  // lazy initializer above (computed during render, not in an effect) —
  // this effect only sets up the periodic refresh, it doesn't need to set
  // state synchronously on entry too.
  useEffect(() => {
    if (!current || current.tier !== "still") return;
    const interval = setInterval(() => setStillCacheBust(Date.now()), stillRefreshMs);
    return () => clearInterval(interval);
  }, [current, stillRefreshMs]);

  const handleEmbedLoad = useCallback(() => {
    embedLoadedRef.current = true;
    // NOTE (flagged for review): `onLoad` on a cross-origin iframe only
    // confirms the outer document loaded — it can't confirm the video
    // inside is actually playing (that's opaque to us by design, since we
    // don't have same-origin access into sandboxed third-party content).
    // This is a known, accepted limit of iframe-based failure detection,
    // not a gap specific to this implementation.
    logger.debug("embed_loaded", { label: source.label });
  }, [source.label]);

  if (!current) {
    const message =
      tiers.length === 0
        ? "No media source is configured for this camera."
        : (lastFailureMessage ?? "This camera is currently unavailable.");
    return (
      <UnavailablePanel
        label={source.label}
        message={message}
        onRetry={tiers.length > 0 ? retry : undefined}
        className={className}
      />
    );
  }

  if (current.tier === "stream") {
    return (
      <div className={`overflow-hidden rounded-lg bg-black ${className}`}>
        <video
          key={current.url}
          src={current.url}
          controls
          muted
          playsInline
          autoPlay
          className="aspect-video w-full"
          onError={() => advance("stream_error")}
          onStalled={() => advance("stream_stalled")}
        >
          Your browser cannot play this video stream.
        </video>
      </div>
    );
  }

  if (current.tier === "embed") {
    // Hard gate: refuse to render anything for a non-allowlisted hostname.
    // Checked synchronously in render (not just in the effect above) so a
    // disallowed URL is never mounted into the DOM even transiently.
    if (!isAllowlistedEmbedUrl(current.url)) {
      return (
        <UnavailablePanel
          label={source.label}
          message={FAILURE_MESSAGES.embed_domain_not_allowlisted}
          className={className}
        />
      );
    }

    return (
      <div className={`overflow-hidden rounded-lg bg-black ${className}`}>
        <iframe
          key={current.url}
          src={current.url}
          title={`${source.label} — live camera embed`}
          className="aspect-video w-full border-0"
          // Most-restrictive sandbox that still renders a third-party
          // video embed (THREAT_MODEL.md §9/§10: "treat any embedded
          // third-party player as untrusted content"). Every permission
          // below is justified individually — nothing is included
          // speculatively:
          //
          // INCLUDED:
          // - allow-scripts: required. Essentially every real-world
          //   video-camera embed (custom player chrome, JS-driven HLS
          //   playback, live status overlays) needs JS to render at all;
          //   without it most third-party embeds show a blank frame.
          //
          // DELIBERATELY OMITTED (documented, not just left off by
          // default):
          // - allow-same-origin: NOT included. Paired with allow-scripts
          //   this is the classic risky combination — it would give the
          //   framed document real access to its own origin's cookies/
          //   storage alongside script execution. This app has no reason
          //   to let an embedded player persist its own session/identity,
          //   and THREAT_MODEL.md §9 requires this iframe never carry any
          //   session shared with app auth — omitting allow-same-origin
          //   also forces the frame into an opaque origin, so it can't
          //   reach for persistent identity of its own either. Trade-off
          //   flagged for founder review: a real negotiated embed
          //   provider might rely on its own cookies for basic playback
          //   features; if that breaks a real partner's embed later,
          //   that's a per-domain call to revisit, not a reason to loosen
          //   the default for everyone.
          // - allow-forms: no legitimate use for a passive camera viewer;
          //   forms are a classic formjacking/phishing vector.
          // - allow-popups / allow-top-navigation /
          //   allow-top-navigation-by-user-activation: exactly the
          //   clickjacking/redirect vectors THREAT_MODEL.md §9/§10 calls
          //   out — untrusted content must never be able to pop a window
          //   or navigate/replace this app.
          // - allow-modals: would let third-party content block the page
          //   with alert()/confirm()/print().
          // - allow-downloads, allow-pointer-lock,
          //   allow-orientation-lock, allow-presentation: no legitimate
          //   use for a camera embed.
          sandbox="allow-scripts"
          // No `allow` (Permissions Policy) attribute is set — nothing
          // (camera, microphone, autoplay, storage-access, etc.) is
          // explicitly granted, matching the "most restrictive" default.
          // A viewer may need to tap play inside the frame if the
          // provider requires a user gesture for autoplay under this
          // restriction; treated as an acceptable trade-off here.
          //
          // Never pass any app-auth token, session id, or user identifier
          // into this URL (as a query param or otherwise) or via
          // postMessage — this frame is fully isolated third-party
          // content, not an app surface (THREAT_MODEL.md §9).
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={handleEmbedLoad}
          onError={() => advance("embed_error")}
        />
      </div>
    );
  }

  // still tier
  const stillSrc = `${current.url}${current.url.includes("?") ? "&" : "?"}_cb=${stillCacheBust}`;
  return (
    <div className={`overflow-hidden rounded-lg bg-black ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- this is a
          periodically re-fetched, arbitrary third-party still-image URL
          (cache-busted on every refresh), not a static local asset, so
          next/image's build-time optimization pipeline doesn't apply. */}
      <img
        key={current.url}
        src={stillSrc}
        alt={`${source.label} — most recent still image`}
        className="aspect-video w-full object-cover"
        onError={() => advance("still_error")}
      />
    </div>
  );
}

function UnavailablePanel({
  label,
  message,
  onRetry,
  className = "",
}: {
  label: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-400/50 bg-zinc-100 px-4 text-center dark:border-zinc-600/50 dark:bg-zinc-900 ${className}`}
    >
      <span aria-hidden="true" className="text-xl">
        📷🚫
      </span>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label} unavailable</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-full border border-zinc-400/50 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:border-zinc-600/50 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Retry
        </button>
      )}
    </div>
  );
}
