import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // The offline fallback page isn't a static asset, so it's precached
  // explicitly; a per-build revision makes each deploy re-fetch it.
  additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
