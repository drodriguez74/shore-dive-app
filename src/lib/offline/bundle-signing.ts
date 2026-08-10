import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SERVER-ONLY. Do not import this from a client component (`"use client"`)
 * or anything reachable from one — it reads `BUNDLE_SIGNING_SECRET`, a
 * server secret that must never ship to the browser, and uses Node's
 * `node:crypto`, which isn't available client-side anyway (a build targeting
 * a client bundle will fail to resolve it, which is a feature, not a bug —
 * treat that failure as "you imported this from the wrong place").
 *
 * Task 12 (Intent-Driven Offline Cache) / T12.2 — THREAT_MODEL.md §2's core
 * finding: an offline bundle (hazard maps, site telemetry, imagery) fetched
 * over an untrusted network (hotel/marina wifi before a trip) must be
 * verifiable, not just trusted because it arrived. This module is the
 * server-side half of that: sign a bundle manifest with an HMAC so a client
 * can later prove the manifest it received is the one the server produced,
 * not something a MITM or compromised CDN swapped in.
 *
 * Where this actually gets *called* from — a future API route that runs
 * when a site's offline assets are prepared/uploaded to Supabase Storage —
 * does not exist yet. That's T12.1-dependent (no live Supabase project/
 * bucket exists yet, blocked on a founder action). This file is pure,
 * self-contained signing/verification logic that doesn't need that route or
 * a live bucket to be correct; wire it into the real upload flow once T12.1
 * lands, don't build a fake route that pretends to talk to a real bucket in
 * the meantime.
 *
 * T12.1 note: the `offline-bundles` bucket + RLS now exist in migration
 * form (`supabase/migrations/0004_offline_bundles_storage.sql`), ready to
 * apply the moment a live Supabase project exists — that "no live
 * project" blocker above is about the project/founder action (P0-A.1),
 * not a missing bucket definition.
 */

/** One file's identity within an offline bundle. */
export interface BundleManifestFile {
  /** Path/key of the asset within the bundle (e.g. a Supabase Storage object path, relative to the bundle root). */
  path: string;
  /** Lowercase hex-encoded SHA-256 of the file's contents. */
  sha256: string;
}

/**
 * Describes the contents of one site's offline bundle. Deliberately simple —
 * an identity, a generation timestamp, and a flat list of (path, hash) pairs
 * for every file the bundle contains. The manifest itself, not the files it
 * describes, is what gets signed; per-file hashes are checked independently,
 * client-side, against the actual downloaded bytes (see
 * `bundle-verification.ts`).
 */
export interface BundleManifest {
  /** Site this bundle belongs to — matches `sites.id` (P0-B) once that schema is live in a real project. */
  siteId: string;
  /** ISO 8601 timestamp of when this manifest was generated server-side. */
  generatedAt: string;
  files: BundleManifestFile[];
}

export interface SignedManifest {
  manifest: BundleManifest;
  /** Lowercase hex-encoded HMAC-SHA256 signature over the canonicalized manifest. */
  signature: string;
}

/**
 * Deterministic JSON serialization: recursively sorts object keys so the
 * same manifest always canonicalizes to the same string regardless of key
 * insertion order. Without this, `JSON.stringify` alone would make the
 * signature brittle to incidental object-construction order, which would
 * either cause false-negative verification failures or (worse) tempt a
 * future caller into loosening the comparison to compensate.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Reads the signing secret from the environment. Deliberately no hardcoded
 * fallback — a fallback secret would defeat the entire point of signing
 * (anyone reading the source, i.e. everyone, could forge a valid signature).
 * Checked lazily, inside the functions that need it, not at module load
 * time, so importing this module doesn't crash a build/typecheck pass in an
 * environment where `.env.local` isn't configured yet (same pattern as
 * `src/lib/supabase/server.ts`).
 */
function getSigningSecret(): string {
  const secret = process.env.BUNDLE_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "BUNDLE_SIGNING_SECRET is not set. Signing/verifying offline bundle manifests requires this " +
        "server-only secret — see .env.local.example. Refusing to sign or verify without it rather than " +
        "falling back to a hardcoded value, which would make the signature meaningless.",
    );
  }
  return secret;
}

/** Signs a bundle manifest, returning the manifest alongside its HMAC-SHA256 signature (hex-encoded). */
export function signManifest(manifest: BundleManifest): SignedManifest {
  const secret = getSigningSecret();
  const signature = createHmac("sha256", secret).update(canonicalize(manifest)).digest("hex");
  return { manifest, signature };
}

/**
 * Verifies a manifest against a previously produced signature. Returns
 * `false` — never throws past this boundary — for any failure mode
 * (missing secret, malformed signature, mismatched signature): callers
 * should treat `false` uniformly as "do not trust this manifest," per
 * THREAT_MODEL.md §2's fail-closed requirement.
 *
 * Uses `timingSafeEqual` rather than `===`/string comparison — this is a
 * security-relevant comparison (an HMAC check), and a naive comparison can
 * leak timing information about how many leading bytes matched.
 */
export function verifyManifest(manifest: BundleManifest, signature: string): boolean {
  let secret: string;
  try {
    secret = getSigningSecret();
  } catch {
    // No secret configured server-side — cannot verify anything, so fail
    // closed rather than throw past this function's boundary.
    return false;
  }

  const expected = createHmac("sha256", secret).update(canonicalize(manifest)).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch instead of returning false —
  // guard explicitly so a malformed/truncated signature fails closed instead
  // of throwing an unhandled exception out of a security check.
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
