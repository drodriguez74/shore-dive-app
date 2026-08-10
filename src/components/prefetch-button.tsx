"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import {
  computeSha256Hex,
  verifyBundleIntegrity,
  type SignatureVerifier,
} from "@/lib/offline/bundle-verification";
import type { BundleManifest } from "@/lib/offline/bundle-signing";

/**
 * Manual "Prefetch Now" trigger (T12.6). Resolved Decision 3 in plan.md:
 * background/periodic sync is opportunistic at best on the web, so a
 * manual trigger is the *reliable* path, not a fallback for a broken one —
 * this button is a first-class part of the offline story, not a nice-to-have.
 */

export interface PrefetchButtonProps {
  siteId?: string;
  siteName?: string;
  className?: string;
}

type Status = "idle" | "loading" | "success" | "error";

export function PrefetchButton({
  siteId = "mock-site-1",
  siteName = "La Jolla Cove",
  className = "",
}: PrefetchButtonProps) {
  const [status, setStatus] = useState<Status>("idle");

  async function handlePrefetch() {
    setStatus("loading");
    try {
      // TODO(Task 12 backend, T12.1): there is no real bundle to fetch yet —
      // no live Supabase Storage bucket exists (founder action, not yet
      // done). Once it does, replace the mock manifest/file/verifier below
      // with:
      //   1. fetch the signed bundle manifest for `siteId` from Supabase
      //      Storage (a `SignedManifest` from bundle-signing.ts's shape);
      //   2. fetch the actual bundle files it references;
      //   3. call `verifyBundleIntegrity(manifest, signature, files)` with
      //      NO injected `verifySignature` override — let it use the real
      //      default (which calls `/api/verify-bundle`, itself still
      //      T12.1-dependent future wiring).
      // What's real *today*, ready to keep as-is once the above lands: the
      // verify-before-trust shape itself — `verifyBundleIntegrity` is
      // called and its result gated on before anything is written to
      // `db.cachedSites`, and a failed check surfaces an error state
      // instead of a cached record (THREAT_MODEL.md §2 — fail closed, never
      // silently trust a bundle that didn't check out).
      const mockFileContent = new TextEncoder().encode(
        JSON.stringify({ mock: true, siteId, note: "Placeholder bundle payload — no real bundle backend yet (T12.1)." }),
      ).buffer;
      const mockManifest: BundleManifest = {
        siteId,
        generatedAt: new Date().toISOString(),
        files: [{ path: `${siteId}/site-data.json`, sha256: await computeSha256Hex(mockFileContent) }],
      };
      // There's no real signed manifest to check yet, so the default
      // (fetch-based, real) signature verifier would always fail closed
      // here — correctly, but that would make this demo button permanently
      // show "error" until T12.1/an /api/verify-bundle route exist. This
      // injected mock verifier stands in for that server round-trip so the
      // interaction shape (verify -> gate -> write) is exercised end-to-end;
      // swap it out (drop the 4th argument) once a real endpoint exists.
      const mockSignatureVerifier: SignatureVerifier = async () => true;

      const verification = await verifyBundleIntegrity(
        mockManifest,
        "mock-signature-not-a-real-hmac",
        [{ path: mockManifest.files[0].path, content: mockFileContent }],
        mockSignatureVerifier,
      );

      if (!verification.ok) {
        console.error("[PrefetchButton] bundle verification failed — failing closed, not caching", {
          siteId,
          reason: verification.reason,
          mismatches: verification.mismatches,
        });
        setStatus("error");
        return;
      }

      await db.cachedSites.put({
        id: siteId,
        name: siteName,
        provenance: "VERIFIED",
        data: { mock: true, note: "Placeholder bundle — no real offline bundle backend yet (T12.1)." },
        cachedAt: new Date(),
      });
      setStatus("success");
    } catch (error) {
      // No structured logger wired up yet in this codebase — following the
      // console.error(tag, context) convention used elsewhere
      // (src/lib/supabase/profile.ts) until one lands.
      console.error("[PrefetchButton] failed to write cached record", {
        siteId,
        error: error instanceof Error ? error.message : error,
      });
      setStatus("error");
    }
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={handlePrefetch}
        disabled={status === "loading"}
        className="rounded-md bg-sky-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Prefetching…" : "Prefetch Now"}
      </button>
      {status === "success" && (
        <span className="text-sm text-emerald-700 dark:text-emerald-400">Cached for offline use.</span>
      )}
      {status === "error" && (
        <span className="text-sm text-red-700 dark:text-red-400">Couldn&apos;t cache this site — try again.</span>
      )}
    </div>
  );
}
