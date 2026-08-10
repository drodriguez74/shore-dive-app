import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeSha256Hex,
  verifyBundleIntegrity,
  verifyFileChecksums,
  type FileToVerify,
} from "./bundle-verification";
import type { BundleManifest } from "./bundle-signing";

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

async function manifestFor(files: { path: string; content: string }[]): Promise<BundleManifest> {
  return {
    siteId: "site-123",
    generatedAt: "2026-08-06T12:00:00.000Z",
    files: await Promise.all(
      files.map(async (f) => ({ path: f.path, sha256: await computeSha256Hex(toArrayBuffer(f.content)) })),
    ),
  };
}

describe("verifyFileChecksums", () => {
  it("passes when every file's actual hash matches the manifest", async () => {
    const manifest = await manifestFor([
      { path: "hazards.json", content: "hazard-data" },
      { path: "telemetry.json", content: "telemetry-data" },
    ]);
    const files: FileToVerify[] = [
      { path: "hazards.json", content: toArrayBuffer("hazard-data") },
      { path: "telemetry.json", content: toArrayBuffer("telemetry-data") },
    ];

    const result = await verifyFileChecksums(manifest, files);
    expect(result).toEqual({ ok: true, mismatches: [] });
  });

  it("detects tampering: content that doesn't match the manifest's hash", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "original-content" }]);
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("tampered-content") }];

    const result = await verifyFileChecksums(manifest, files);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual(["hazards.json"]);
  });

  it("treats a manifest entry with no corresponding downloaded file as a mismatch", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
    const result = await verifyFileChecksums(manifest, []);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual(["hazards.json"]);
  });

  it("is case-insensitive when comparing against the manifest's hex hash", async () => {
    const realHash = await computeSha256Hex(toArrayBuffer("hazard-data"));
    const manifest: BundleManifest = {
      siteId: "site-123",
      generatedAt: "2026-08-06T12:00:00.000Z",
      files: [{ path: "hazards.json", sha256: realHash.toUpperCase() }],
    };
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];

    const result = await verifyFileChecksums(manifest, files);
    expect(result.ok).toBe(true);
  });

  it("reports multiple mismatches independently, not just the first", async () => {
    const manifest = await manifestFor([
      { path: "a.json", content: "a-content" },
      { path: "b.json", content: "b-content" },
    ]);
    const files: FileToVerify[] = [
      { path: "a.json", content: toArrayBuffer("TAMPERED") },
      // b.json missing entirely
    ];

    const result = await verifyFileChecksums(manifest, files);
    expect(result.ok).toBe(false);
    expect(result.mismatches.sort()).toEqual(["a.json", "b.json"]);
  });
});

describe("verifyBundleIntegrity", () => {
  it("reports ok:true only when both checksums and signature pass", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];
    const verifySignature = vi.fn().mockResolvedValue(true);

    const result = await verifyBundleIntegrity(manifest, "sig", files, verifySignature);
    expect(result).toEqual({ ok: true });
    expect(verifySignature).toHaveBeenCalledWith(manifest, "sig");
  });

  it("short-circuits on a checksum mismatch without calling the signature verifier", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "original" }]);
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("tampered") }];
    const verifySignature = vi.fn().mockResolvedValue(true);

    const result = await verifyBundleIntegrity(manifest, "sig", files, verifySignature);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("checksum-mismatch");
    expect(result.mismatches).toEqual(["hazards.json"]);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("fails closed when the injected signature verifier returns false", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];
    const verifySignature = vi.fn().mockResolvedValue(false);

    const result = await verifyBundleIntegrity(manifest, "bad-sig", files, verifySignature);
    expect(result).toEqual({ ok: false, reason: "signature-invalid" });
  });

  it("fails closed when the injected signature verifier throws", async () => {
    const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
    const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];
    const verifySignature = vi.fn().mockRejectedValue(new Error("verification endpoint blew up"));

    const result = await verifyBundleIntegrity(manifest, "sig", files, verifySignature);
    expect(result).toEqual({ ok: false, reason: "signature-invalid" });
  });

  describe("default signature verifier (no verification endpoint exists yet)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("fails closed when the endpoint 404s", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
      const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];

      // No verifySignature passed -> exercises the real default (fetchSignatureVerifier).
      const result = await verifyBundleIntegrity(manifest, "sig", files);
      expect(result).toEqual({ ok: false, reason: "signature-invalid" });
    });

    it("fails closed when the fetch itself throws (network error)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network unreachable"));
      const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
      const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];

      const result = await verifyBundleIntegrity(manifest, "sig", files);
      expect(result).toEqual({ ok: false, reason: "signature-invalid" });
    });

    it("does not fall back to true even on a 2xx with an unexpected body shape", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ nonsense: true }), { status: 200 }));
      const manifest = await manifestFor([{ path: "hazards.json", content: "hazard-data" }]);
      const files: FileToVerify[] = [{ path: "hazards.json", content: toArrayBuffer("hazard-data") }];

      const result = await verifyBundleIntegrity(manifest, "sig", files);
      expect(result).toEqual({ ok: false, reason: "signature-invalid" });
    });
  });
});
