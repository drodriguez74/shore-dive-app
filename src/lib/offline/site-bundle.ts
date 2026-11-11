import { createHash } from "node:crypto";
import type { HazardReport, Site } from "@/lib/sites/types";
import { signManifest, type BundleManifest } from "./bundle-signing";
import {
  SITE_BUNDLE_SCHEMA_VERSION,
  SITE_DATA_FILE,
  type OfflineSitePayload,
  type SiteBundleResponse,
} from "./site-bundle-payload";

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/**
 * Server-side builder for a site's signed offline bundle (Task 12,
 * THREAT_MODEL.md §2). Throws if `BUNDLE_SIGNING_SECRET` is unset — callers
 * must surface that as "offline saving unavailable", never serve an
 * unsigned bundle.
 */
export function buildSiteBundle(
  site: Site,
  hazards: HazardReport[],
  hazardsTruncated: boolean,
  now: Date = new Date(),
): SiteBundleResponse {
  const payload: OfflineSitePayload = {
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    site: omit(site, "created_by"),
    hazards: hazards.map((hazard) => omit(hazard, "reported_by")),
    hazardsTruncated,
  };

  const content = JSON.stringify(payload);
  const path = `${site.id}/${SITE_DATA_FILE}`;
  const manifest: BundleManifest = {
    siteId: site.id,
    generatedAt: now.toISOString(),
    files: [{ path, sha256: createHash("sha256").update(content, "utf8").digest("hex") }],
  };

  const { signature } = signManifest(manifest);
  return { manifest, signature, files: [{ path, content }] };
}
