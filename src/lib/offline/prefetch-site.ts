import { db, type CachedSiteRecord } from "@/lib/db";
import { errorMessage } from "@/lib/error-message";
import { verifyBundleIntegrity, type SignatureVerifier } from "./bundle-verification";
import { logger } from "./logger";
import {
  parseOfflineSitePayload,
  parseSiteBundleResponse,
  SITE_DATA_FILE,
  type OfflineSitePayload,
} from "./site-bundle-payload";

/**
 * Client half of the offline prefetch pipeline (Task 12): fetch a site's
 * signed bundle, verify it, and only then write it to IndexedDB. Every
 * failure resolves to a typed reason — nothing here throws, and nothing is
 * cached unless verification passed (THREAT_MODEL.md §2, fail closed).
 */

export type PrefetchFailureReason =
  | "offline"
  | "not-configured"
  | "not-found"
  | "network"
  | "invalid-bundle"
  | "verification-failed"
  | "storage";

export type PrefetchResult =
  | { ok: true; cachedAt: Date; hazardCount: number }
  | { ok: false; reason: PrefetchFailureReason };

export interface CachedSite {
  payload: OfflineSitePayload;
  cachedAt: Date;
}

export interface PrefetchDeps {
  fetch?: typeof fetch;
  save?: (record: CachedSiteRecord) => Promise<void>;
  verifySignature?: SignatureVerifier;
  now?: () => Date;
  isOnline?: () => boolean;
}

/** Below this much free quota we refuse rather than risk filling a phone the Safe-Return timer also depends on. */
const MIN_FREE_BYTES = 5 * 1024 * 1024;

async function hasStorageHeadroom(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return true;
    const { quota, usage } = await navigator.storage.estimate();
    if (typeof quota !== "number" || typeof usage !== "number") return true;
    return quota - usage >= MIN_FREE_BYTES;
  } catch {
    return true;
  }
}

async function saveToIndexedDb(record: CachedSiteRecord): Promise<void> {
  if (!(await hasStorageHeadroom())) throw new Error("Not enough free device storage.");
  await db.cachedSites.put(record);
  // Best-effort: ask the browser not to evict this origin's data under storage pressure.
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Unsupported or denied — the save itself already succeeded.
  }
}

/** Fired on `window` after the saved-sites cache changes, so mounted UI can re-read it. */
export const OFFLINE_CACHE_CHANGED_EVENT = "shore-dive:offline-cache-changed";

function announceCacheChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_CACHE_CHANGED_EVENT));
}

function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export async function prefetchSite(siteId: string, deps: PrefetchDeps = {}): Promise<PrefetchResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const save = deps.save ?? saveToIndexedDb;
  const now = deps.now ?? (() => new Date());
  const isOnline = deps.isOnline ?? browserIsOnline;

  const fail = (reason: PrefetchFailureReason, fields: Record<string, unknown> = {}): PrefetchResult => {
    logger.warn("prefetch.failed", { siteId, reason, ...fields });
    return { ok: false, reason };
  };

  if (!isOnline()) return fail("offline");

  let body: unknown;
  try {
    const response = await fetchImpl(`/api/sites/${encodeURIComponent(siteId)}/offline-bundle`, {
      cache: "no-store",
    });
    if (response.status === 503) return fail("not-configured");
    if (response.status === 404) return fail("not-found");
    if (!response.ok) return fail("network", { status: response.status });
    body = await response.json();
  } catch (error) {
    return fail("network", { error: errorMessage(error) });
  }

  const bundle = parseSiteBundleResponse(body);
  if (!bundle || bundle.manifest.siteId !== siteId) return fail("invalid-bundle");

  const encoder = new TextEncoder();
  const files = bundle.files.map((file) => ({
    path: file.path,
    content: encoder.encode(file.content).buffer as ArrayBuffer,
  }));

  const verification = await verifyBundleIntegrity(bundle.manifest, bundle.signature, files, deps.verifySignature);
  if (!verification.ok) {
    return fail("verification-failed", { detail: verification.reason, mismatches: verification.mismatches });
  }

  // Only a file the signed manifest lists has been checksummed — never read one it doesn't.
  const dataPath = `${siteId}/${SITE_DATA_FILE}`;
  const dataFile = bundle.manifest.files.some((entry) => entry.path === dataPath)
    ? bundle.files.find((file) => file.path === dataPath)
    : undefined;
  let payload: OfflineSitePayload | null = null;
  try {
    payload = dataFile ? parseOfflineSitePayload(JSON.parse(dataFile.content)) : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.site.id !== siteId) return fail("invalid-bundle");

  const cachedAt = now();
  try {
    await save({
      id: siteId,
      name: payload.site.name,
      provenance: payload.site.provenance,
      data: { ...payload },
      cachedAt,
    });
  } catch (error) {
    return fail("storage", { error: errorMessage(error) });
  }

  logger.info("prefetch.saved", { siteId, hazardCount: payload.hazards.length });
  announceCacheChange();
  return { ok: true, cachedAt, hazardCount: payload.hazards.length };
}

function toCachedSite(record: CachedSiteRecord): CachedSite | null {
  const payload = parseOfflineSitePayload(record.data);
  if (!payload) return null;
  return { payload, cachedAt: record.cachedAt };
}

/** A record that no longer parses (older schema, corruption) reads as "not cached". */
export async function getCachedSite(siteId: string): Promise<CachedSite | null> {
  try {
    const record = await db.cachedSites.get(siteId);
    return record ? toCachedSite(record) : null;
  } catch (error) {
    logger.error("cache.read_failed", { siteId, error: errorMessage(error) });
    return null;
  }
}

export interface ListCachedSitesResult {
  sites: CachedSite[];
  /** Set when IndexedDB itself couldn't be read — distinct from "nothing saved". */
  error: string | null;
}

export async function listCachedSites(): Promise<ListCachedSitesResult> {
  try {
    const records = await db.cachedSites.toArray();
    const sites = records
      .map(toCachedSite)
      .filter((site): site is CachedSite => site !== null)
      .sort((a, b) => a.payload.site.name.localeCompare(b.payload.site.name));
    return { sites, error: null };
  } catch (error) {
    logger.error("cache.list_failed", { error: errorMessage(error) });
    return { sites: [], error: errorMessage(error) };
  }
}

export async function removeCachedSite(siteId: string): Promise<boolean> {
  try {
    await db.cachedSites.delete(siteId);
    announceCacheChange();
    return true;
  } catch (error) {
    logger.error("cache.remove_failed", { siteId, error: errorMessage(error) });
    return false;
  }
}
