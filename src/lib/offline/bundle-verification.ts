import type { BundleManifest } from "./bundle-signing";

/**
 * Client-safe bundle verification (Task 12 / T12.8). Companion to
 * `bundle-signing.ts` — read that file's header first.
 *
 * THREAT_MODEL.md §2's requirement: a corrupted or tampered offline bundle
 * must fail closed (treated as NOT cached) rather than silently being marked
 * ready-for-offline-use. This module is what a client calls to decide that,
 * before `src/lib/db.ts` ever gets a `cachedAt` write.
 *
 * Honest split between what's real today and what's still blocked on T12.1
 * (no live Supabase Storage bucket yet) — read this before wiring in a real
 * bundle fetch:
 *
 * 1. **Checksum verification (`verifyFileChecksums`) is real, working logic
 *    today.** It hashes each downloaded file with the Web Crypto API
 *    (`crypto.subtle.digest`, browser-native, no secret needed) and compares
 *    against the manifest's per-file SHA-256. This proves the bytes that
 *    landed on the device match what the manifest claims — it does NOT
 *    prove the manifest itself is authentic (a MITM could swap both the
 *    manifest and the files together, matching hashes, unless the manifest
 *    is separately signed — see #2).
 *
 * 2. **Signature verification cannot run client-side, by design.** The
 *    manifest is HMAC-signed server-side with `BUNDLE_SIGNING_SECRET`
 *    (`bundle-signing.ts`), and that secret must never reach the browser —
 *    shipping it client-side would let anyone forge a valid signature,
 *    defeating the entire point. So proving the manifest itself is genuine
 *    requires a server round-trip: the client sends `(manifest, signature)`
 *    to a verification endpoint, the server re-derives the HMAC with its
 *    secret and answers yes/no. That endpoint (`/api/verify-bundle`) does
 *    not exist yet — it's meaningless to build without a live bundle
 *    pipeline behind it (T12.1). `verifyBundleIntegrity` below is written
 *    against a clean, injectable interface (`SignatureVerifier`) so the real
 *    endpoint can be dropped in later without touching call sites; the
 *    default implementation calls the not-yet-existing route and — this is
 *    the important part — resolves to `false` when that 404s or the request
 *    otherwise fails, which means the fail-closed behavior is already
 *    correct today, not a stand-in that needs fixing later.
 */

export interface FileToVerify {
  path: string;
  content: ArrayBuffer;
}

export interface ChecksumVerificationResult {
  ok: boolean;
  /** Paths missing from the provided files, or whose computed hash didn't match the manifest. */
  mismatches: string[];
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of `data`, lowercase hex-encoded. Requires the Web Crypto API (`crypto.subtle`) — available in all browsers this app targets, including over plain HTTP on `localhost` for local dev. */
export async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is unavailable in this environment — cannot verify checksums.");
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

/**
 * Verifies every file the manifest lists against its actual downloaded
 * bytes. Missing files and hashing failures are both treated as mismatches
 * (fail closed) rather than skipped — a file that can't be checked is not
 * the same as a file that checked out fine.
 */
export async function verifyFileChecksums(
  manifest: BundleManifest,
  files: FileToVerify[],
): Promise<ChecksumVerificationResult> {
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));
  const mismatches: string[] = [];

  for (const entry of manifest.files) {
    const content = contentByPath.get(entry.path);
    if (!content) {
      mismatches.push(entry.path);
      continue;
    }
    try {
      const actualHash = await computeSha256Hex(content);
      if (actualHash !== entry.sha256.toLowerCase()) {
        mismatches.push(entry.path);
      }
    } catch (error) {
      console.error("[bundle-verification] checksum hashing failed", {
        path: entry.path,
        error: error instanceof Error ? error.message : error,
      });
      mismatches.push(entry.path);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Dependency-injected signature check, so a real server-backed implementation can replace the stub without changing `verifyBundleIntegrity`'s call sites. */
export type SignatureVerifier = (manifest: BundleManifest, signature: string) => Promise<boolean>;

/**
 * Default `SignatureVerifier` — calls a verification endpoint that does not
 * exist yet (blocked on T12.1: there's no live bundle pipeline for it to
 * check against). Left wired up rather than omitted so the *shape* of "ask
 * the server, trust nothing client-side" is visible and correct.
 *
 * Do not "fix" a non-2xx/network-error response to return `true` — a
 * missing or unreachable verification endpoint must read as "unverified,"
 * never as "verified." That is what makes this safe to leave in place
 * before the endpoint exists, rather than something that needs a guard
 * added later.
 */
async function fetchSignatureVerifier(manifest: BundleManifest, signature: string): Promise<boolean> {
  try {
    const response = await fetch("/api/verify-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, signature }),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as { valid?: unknown }).valid === true;
  } catch (error) {
    console.error("[bundle-verification] signature verification request failed", {
      siteId: manifest.siteId,
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
}

export interface BundleVerificationResult {
  ok: boolean;
  reason?: "checksum-mismatch" | "signature-invalid";
  /** Populated when `reason` is `"checksum-mismatch"`. */
  mismatches?: string[];
}

/**
 * The single entry point callers (e.g. `prefetch-button.tsx`) should use:
 * verify checksums, then the manifest signature, and only report `ok: true`
 * if both pass. Fails closed on any error in either step — a thrown
 * `verifySignature` is caught and treated as a failed check, not propagated.
 */
export async function verifyBundleIntegrity(
  manifest: BundleManifest,
  signature: string,
  files: FileToVerify[],
  verifySignature: SignatureVerifier = fetchSignatureVerifier,
): Promise<BundleVerificationResult> {
  const checksums = await verifyFileChecksums(manifest, files);
  if (!checksums.ok) {
    return { ok: false, reason: "checksum-mismatch", mismatches: checksums.mismatches };
  }

  let signatureOk: boolean;
  try {
    signatureOk = await verifySignature(manifest, signature);
  } catch (error) {
    console.error("[bundle-verification] signature verifier threw", {
      siteId: manifest.siteId,
      error: error instanceof Error ? error.message : error,
    });
    signatureOk = false;
  }

  if (!signatureOk) {
    return { ok: false, reason: "signature-invalid" };
  }

  return { ok: true };
}
