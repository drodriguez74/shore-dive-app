import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { EMBED_DOMAIN_ALLOWLIST } from "./src/components/media-embed/allowlist";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The offline fallback page isn't a static asset, so it's precached
  // explicitly; a per-build revision makes each deploy re-fetch it.
  additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
});

// A deliberately partial CSP: it locks down framing, plugins, base/form
// targets and which sites may be embedded, without a script-src (Next's
// inline scripts and Mapbox's blob workers would need nonces first).
const contentSecurityPolicy = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  `frame-src 'self' ${EMBED_DOMAIN_ALLOWLIST.map((host) => `https://${host}`).join(" ")}`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Only the device features the app actually uses, and only for itself.
  { key: "Permissions-Policy", value: "geolocation=(self), microphone=(self), camera=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(nextConfig);
