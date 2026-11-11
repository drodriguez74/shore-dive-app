import { NextResponse, type NextRequest } from "next/server";
import { verifyManifest, type BundleManifest } from "@/lib/offline/bundle-signing";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/offline/logger";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const MAX_MANIFEST_FILES = 50;
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function isManifest(value: unknown): value is BundleManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.siteId !== "string" || typeof manifest.generatedAt !== "string") return false;
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_MANIFEST_FILES) return false;
  return manifest.files.every(
    (file) =>
      typeof file === "object" &&
      file !== null &&
      typeof (file as Record<string, unknown>).path === "string" &&
      typeof (file as Record<string, unknown>).sha256 === "string",
  );
}

/**
 * Verifies a bundle manifest's HMAC signature (T12.8). The signing secret
 * must never reach the browser, so the client asks the server; anything
 * other than a confirmed match answers `valid: false`.
 */
export async function POST(request: NextRequest) {
  if (!limiter.allow(clientKey(request))) {
    return NextResponse.json({ valid: false, error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false, error: "Malformed JSON." }, { status: 400 });
  }

  const { manifest, signature } = (body ?? {}) as { manifest?: unknown; signature?: unknown };
  if (!isManifest(manifest) || typeof signature !== "string" || signature.length > 256) {
    return NextResponse.json({ valid: false, error: "Malformed request." }, { status: 400 });
  }

  try {
    const valid = verifyManifest(manifest, signature);
    if (!valid) logger.warn("verify.signature_rejected", { siteId: manifest.siteId });
    return NextResponse.json({ valid }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("verify.threw", { siteId: manifest.siteId, error: errorMessage(error) });
    return NextResponse.json({ valid: false });
  }
}
