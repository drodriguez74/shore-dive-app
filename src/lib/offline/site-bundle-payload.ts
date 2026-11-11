import type { HazardReport, Site } from "@/lib/sites/types";
import type { BundleManifest } from "./bundle-signing";

/**
 * Shape of a site's offline bundle (Task 12), shared by the server builder
 * and the browser cache. No `node:` imports here — this module is bundled
 * into client code.
 */

export const SITE_BUNDLE_SCHEMA_VERSION = 1;

/** The single file a v1 bundle carries; images/hazard maps would be added as further files. */
export const SITE_DATA_FILE = "site-data.json";

/** Account ids are dropped — an offline copy has no use for them. */
export type OfflineSite = Omit<Site, "created_by">;
export type OfflineHazardReport = Omit<HazardReport, "reported_by">;

export interface OfflineSitePayload {
  schemaVersion: number;
  site: OfflineSite;
  /** Newest first, as of the bundle's `generatedAt`. */
  hazards: OfflineHazardReport[];
  /** True when the server capped the hazard list — older reports exist that aren't in this copy. */
  hazardsTruncated: boolean;
}

export interface SiteBundleFile {
  path: string;
  /** UTF-8 text; the manifest's sha256 is over these exact bytes. */
  content: string;
}

export interface SiteBundleResponse {
  manifest: BundleManifest;
  signature: string;
  files: SiteBundleFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the envelope of a bundle response; file contents are verified separately by checksum. */
export function parseSiteBundleResponse(value: unknown): SiteBundleResponse | null {
  if (!isRecord(value) || typeof value.signature !== "string") return null;
  const { manifest, files } = value;
  if (!isRecord(manifest) || typeof manifest.siteId !== "string" || typeof manifest.generatedAt !== "string") {
    return null;
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(files)) return null;
  const manifestFilesOk = manifest.files.every(
    (file) => isRecord(file) && typeof file.path === "string" && typeof file.sha256 === "string",
  );
  const filesOk = files.every(
    (file) => isRecord(file) && typeof file.path === "string" && typeof file.content === "string",
  );
  if (!manifestFilesOk || !filesOk) return null;
  return value as unknown as SiteBundleResponse;
}

/**
 * Parses a verified `site-data.json` (or a record read back from IndexedDB).
 * Returns null for anything it can't fully vouch for — an unknown schema
 * version or a site without usable coordinates is "not cached", never a
 * half-rendered page.
 */
export function parseOfflineSitePayload(value: unknown): OfflineSitePayload | null {
  if (!isRecord(value) || value.schemaVersion !== SITE_BUNDLE_SCHEMA_VERSION) return null;
  const { site, hazards } = value;
  if (!isRecord(site) || typeof site.id !== "string" || typeof site.name !== "string") return null;
  if (!Number.isFinite(site.latitude) || !Number.isFinite(site.longitude)) return null;
  if (!Array.isArray(hazards)) return null;
  const hazardsOk = hazards.every(
    (hazard) =>
      isRecord(hazard) &&
      typeof hazard.id === "string" &&
      typeof hazard.description === "string" &&
      typeof hazard.created_at === "string",
  );
  if (!hazardsOk) return null;
  return {
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    site: site as unknown as OfflineSite,
    hazards: hazards as unknown as OfflineHazardReport[],
    hazardsTruncated: value.hazardsTruncated === true,
  };
}
