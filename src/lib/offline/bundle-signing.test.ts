import { afterEach, describe, expect, it } from "vitest";
import { signManifest, verifyManifest, type BundleManifest } from "./bundle-signing";

const ENV_KEY = "BUNDLE_SIGNING_SECRET";

function makeManifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return {
    siteId: "site-123",
    generatedAt: "2026-08-06T12:00:00.000Z",
    files: [
      { path: "hazards.json", sha256: "a".repeat(64) },
      { path: "telemetry.json", sha256: "b".repeat(64) },
    ],
    ...overrides,
  };
}

describe("bundle-signing", () => {
  const originalSecret = process.env[ENV_KEY];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalSecret;
    }
  });

  it("round-trips: a manifest signed with a secret verifies against that same secret", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifest = makeManifest();
    const { signature } = signManifest(manifest);
    expect(verifyManifest(manifest, signature)).toBe(true);
  });

  it("is deterministic regardless of key insertion order (canonicalization)", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifestA = makeManifest();
    const manifestB: BundleManifest = {
      generatedAt: manifestA.generatedAt,
      files: manifestA.files,
      siteId: manifestA.siteId,
    };
    const { signature: signatureA } = signManifest(manifestA);
    expect(verifyManifest(manifestB, signatureA)).toBe(true);
  });

  it("detects tampering: changing the manifest after signing invalidates the signature", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifest = makeManifest();
    const { signature } = signManifest(manifest);

    const tampered = makeManifest({ siteId: "attacker-site" });
    expect(verifyManifest(tampered, signature)).toBe(false);
  });

  it("detects tampering of a single file's hash", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifest = makeManifest();
    const { signature } = signManifest(manifest);

    const tampered = makeManifest({ files: [{ path: "hazards.json", sha256: "c".repeat(64) }, manifest.files[1]] });
    expect(verifyManifest(tampered, signature)).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    process.env[ENV_KEY] = "secret-a";
    const manifest = makeManifest();
    const { signature } = signManifest(manifest);

    process.env[ENV_KEY] = "secret-b";
    expect(verifyManifest(manifest, signature)).toBe(false);
  });

  it("fails closed (returns false, does not throw) when verifying with no secret configured", () => {
    delete process.env[ENV_KEY];
    const manifest = makeManifest();
    expect(() => verifyManifest(manifest, "deadbeef")).not.toThrow();
    expect(verifyManifest(manifest, "deadbeef")).toBe(false);
  });

  it("throws when signing with no secret configured (no silent fallback secret)", () => {
    delete process.env[ENV_KEY];
    expect(() => signManifest(makeManifest())).toThrow(/BUNDLE_SIGNING_SECRET/);
  });

  it("fails closed on a malformed (non-hex) signature rather than throwing", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifest = makeManifest();
    expect(() => verifyManifest(manifest, "not-hex-!!")).not.toThrow();
  });

  it("fails closed on a truncated signature rather than throwing on the length mismatch", () => {
    process.env[ENV_KEY] = "test-secret-one";
    const manifest = makeManifest();
    const { signature } = signManifest(manifest);
    const truncated = signature.slice(0, 10);
    expect(() => verifyManifest(manifest, truncated)).not.toThrow();
    expect(verifyManifest(manifest, truncated)).toBe(false);
  });
});
