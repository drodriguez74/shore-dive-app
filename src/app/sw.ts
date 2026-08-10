/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheableResponsePlugin, ExpirationPlugin, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// T12.5 — runtime-caching for map tiles + site imagery. This is the
// service-worker half of "best-effort prefetch" (plan.md's Intent-Driven
// Offline Cache pillar / Resolved Decision 3); the structured, freshness-
// tracked site/hazard data lives separately in IndexedDB (src/lib/db.ts).
// These are just static visual assets, so StaleWhileRevalidate is fine here:
// serve whatever's cached immediately (works with no signal), refresh in the
// background when a connection exists. Listed ahead of `defaultCache` below
// so these routes win the match before its generic cross-origin fallback
// (NetworkFirst, 1h TTL) would otherwise apply.
const siteAssetCaching: RuntimeCaching[] = [
  {
    // Mapbox tile/style/sprite/glyph requests. Not covered by
    // @serwist/next's default image-extension matcher, since these URLs
    // carry a `?access_token=...` query string after the extension (or, for
    // vector tiles, no file extension at all).
    matcher: ({ url }) => /(^|\.)mapbox\.com$/i.test(url.hostname),
    method: "GET",
    handler: new StaleWhileRevalidate({
      cacheName: "map-tiles",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 500,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    // Site imagery (e.g. future Supabase Storage-hosted site photos),
    // matched by resource type rather than URL extension so it still works
    // behind a signed URL's query string.
    matcher: ({ request }) => request.destination === "image",
    method: "GET",
    handler: new StaleWhileRevalidate({
      cacheName: "site-imagery",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [...siteAssetCaching, ...defaultCache],
});

serwist.addEventListeners();
