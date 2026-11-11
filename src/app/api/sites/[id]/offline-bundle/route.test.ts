// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getSiteWithHazards } from "@/lib/sites/queries";
import { verifyManifest } from "@/lib/offline/bundle-signing";
import { FIXTURE_HAZARDS, FIXTURE_SITE } from "@/lib/offline/test-fixtures";

vi.mock("@/lib/sites/queries", () => ({ getSiteWithHazards: vi.fn() }));

const mockGetSite = vi.mocked(getSiteWithHazards);

function get(id: string) {
  return GET(new NextRequest(`http://localhost/api/sites/${id}/offline-bundle`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/sites/[id]/offline-bundle", () => {
  beforeEach(() => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns a bundle whose signature verifies", async () => {
    mockGetSite.mockResolvedValue({ site: FIXTURE_SITE, hazards: FIXTURE_HAZARDS, truncated: false, error: null });

    const response = await get("site-123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(verifyManifest(body.manifest, body.signature)).toBe(true);
    expect(body.files[0].path).toBe("site-123/site-data.json");
  });

  it("answers 503 without querying when the signing secret is unset", async () => {
    vi.stubEnv("BUNDLE_SIGNING_SECRET", "");

    const response = await get("site-123");

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("not_configured");
    expect(mockGetSite).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown site", async () => {
    mockGetSite.mockResolvedValue({ site: null, hazards: [], truncated: false, error: null });
    expect((await get("nope")).status).toBe(404);
  });

  it("answers 502 when the site query fails", async () => {
    mockGetSite.mockResolvedValue({ site: null, hazards: [], truncated: false, error: "db down" });
    expect((await get("site-123")).status).toBe(502);
  });
});
