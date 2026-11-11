// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { signManifest, type BundleManifest } from "@/lib/offline/bundle-signing";

const MANIFEST: BundleManifest = {
  siteId: "site-123",
  generatedAt: "2026-11-11T12:00:00.000Z",
  files: [{ path: "site-123/site-data.json", sha256: "ab".repeat(32) }],
};

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/verify-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/verify-bundle", () => {
  beforeEach(() => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "test-secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("confirms a genuine signature", async () => {
    const { signature } = signManifest(MANIFEST);
    const response = await post({ manifest: MANIFEST, signature });
    expect(await response.json()).toEqual({ valid: true });
  });

  it("rejects a signature for a different manifest", async () => {
    const { signature } = signManifest(MANIFEST);
    const response = await post({ manifest: { ...MANIFEST, siteId: "other" }, signature });
    expect(await response.json()).toEqual({ valid: false });
  });

  it("answers valid:false when the server has no signing secret", async () => {
    const { signature } = signManifest(MANIFEST);
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "");
    const response = await post({ manifest: MANIFEST, signature });
    expect(await response.json()).toEqual({ valid: false });
  });

  it("rejects malformed requests with 400 and valid:false", async () => {
    for (const body of ["not json", {}, { manifest: MANIFEST }, { manifest: { siteId: 1 }, signature: "x" }]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await response.json()).valid).toBe(false);
    }
  });
});
