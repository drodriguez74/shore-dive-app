// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

/**
 * Minimal recording client for the one chain this route uses:
 * `from("sites").insert(row).select("id").single()`, plus `auth.getUser()`.
 * Same no-live-DB approach as `src/lib/sites/queries.test.ts`.
 */
function useClient(options: { insertResult?: { data: unknown; error: unknown }; user?: unknown } = {}) {
  const { insertResult = { data: { id: "site-123" }, error: null }, user = { id: "user-1" } } = options;
  const inserted: Record<string, unknown>[] = [];

  const builder: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
      return builder;
    },
    select: () => builder,
    single: () => Promise.resolve(insertResult),
  };

  const client = {
    auth: { getUser: () => Promise.resolve({ data: { user }, error: null }) },
    from: () => builder,
  } as unknown as Awaited<ReturnType<typeof createClient>>;

  mockCreateClient.mockResolvedValue(client);
  return { inserted };
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sites/candidates/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Blue Heron Bridge",
  latitude: 26.7834,
  longitude: -80.0417,
  site_type: "shore_reef",
  depth_min_ft: 6,
  depth_max_ft: 20,
  research_summary: "A well-documented shore dive under the bridge.",
  research_sources: [{ title: "Local dive guide", url: "https://example.com/bhb" }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sites/candidates/add", () => {
  it("returns the new marker with numeric coordinates, not PostgREST numeric strings", async () => {
    useClient();
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(201);

    const { site } = (await response.json()) as { site: Record<string, unknown> };
    expect(site.id).toBe("site-123");
    expect(site.latitude).toBe(26.7834);
    expect(site.longitude).toBe(-80.0417);
    expect(typeof site.latitude).toBe("number");
    expect(typeof site.longitude).toBe("number");
    expect(site.depth_min_ft).toBe(6);
    expect(site.depth_max_ft).toBe(20);
    expect(site.provenance).toBe("COMMUNITY");
    expect(site.hasHazardReport).toBe(false);
  });

  it("still returns numeric coordinates even when the DB echoes numeric columns back as strings", async () => {
    // PostgREST commonly serializes `numeric` columns as strings; the route
    // must not let those reach the client (see route.ts's comment).
    useClient({ insertResult: { data: { id: "site-9", latitude: "26.783400", longitude: "-80.041700" }, error: null } });
    const response = await POST(request(VALID_BODY));
    const { site } = (await response.json()) as { site: Record<string, unknown> };
    expect(site.latitude).toBe(26.7834);
    expect(site.longitude).toBe(-80.0417);
  });

  it("persists a COMMUNITY-provenance row through the user's own client", async () => {
    const { inserted } = useClient();
    await POST(request(VALID_BODY));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ provenance: "COMMUNITY", legal_access_status: null, created_by: "user-1" });
  });

  it("401s when there is no authenticated user", async () => {
    useClient({ user: null });
    const response = await POST(request(VALID_BODY));
    expect(response.status).toBe(401);
  });

  it("400s a candidate with no coordinates — it can't be placed on the map", async () => {
    useClient();
    const response = await POST(request({ ...VALID_BODY, latitude: null, longitude: null }));
    expect(response.status).toBe(400);
  });
});
