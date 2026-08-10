import { describe, expect, it } from "vitest";
import { latestStatusPerShop, type LdsStatusRow } from "./lds-status";

/**
 * `latestStatusPerShop` had zero test coverage before (T22.6) — the only
 * thing exercising it was `MOCK_LDS_MARKERS`, a module-level constant
 * evaluated once at import time, which proves the function runs but not
 * that it resolves any specific case correctly. These tests use small,
 * purpose-built local fixtures instead of a shared mock dataset, per the
 * "mocks are good for tests, not for real live data" distinction that
 * removed `MOCK_LDS_LOG`/`MOCK_LDS_MARKERS` from this module.
 */

function row(overrides: Partial<LdsStatusRow> = {}): LdsStatusRow {
  return {
    id: "row-1",
    site_id: null,
    name: "Test Dive Shop",
    latitude: 26.1,
    longitude: -80.1,
    status: "unknown",
    provenance: "COMMUNITY",
    last_verified_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("latestStatusPerShop", () => {
  it("collapses an append-only log to one row per shop, the latest wins", () => {
    const log = [
      row({ id: "r1", name: "Shop A", status: "closed", last_verified_at: "2026-08-01T00:00:00.000Z" }),
      row({ id: "r2", name: "Shop A", status: "open", last_verified_at: "2026-08-05T00:00:00.000Z" }),
    ];

    const result = latestStatusPerShop(log);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "r2", status: "open" });
  });

  it("is not confused by log order — the latest wins even if it appears first", () => {
    const log = [
      row({ id: "r2", name: "Shop A", status: "open", last_verified_at: "2026-08-05T00:00:00.000Z" }),
      row({ id: "r1", name: "Shop A", status: "closed", last_verified_at: "2026-08-01T00:00:00.000Z" }),
    ];

    expect(latestStatusPerShop(log)).toEqual([
      expect.objectContaining({ id: "r2", status: "open" }),
    ]);
  });

  it("matches shops by site_id when set, not by name", () => {
    const log = [
      row({ id: "r1", site_id: "site-1", name: "Shop A", last_verified_at: "2026-08-01T00:00:00.000Z" }),
      row({ id: "r2", site_id: "site-1", name: "Shop A (renamed)", last_verified_at: "2026-08-05T00:00:00.000Z" }),
    ];

    const result = latestStatusPerShop(log);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("r2");
  });

  it("falls back to matching by name when site_id is null", () => {
    const log = [
      row({ id: "r1", site_id: null, name: "Shop A", last_verified_at: "2026-08-01T00:00:00.000Z" }),
      row({ id: "r2", site_id: null, name: "Shop A", last_verified_at: "2026-08-05T00:00:00.000Z" }),
      row({ id: "r3", site_id: null, name: "Shop B", last_verified_at: "2026-08-03T00:00:00.000Z" }),
    ];

    const result = latestStatusPerShop(log);
    expect(result.map((r) => r.id).sort()).toEqual(["r2", "r3"]);
  });

  it("treats a null site_id and a same-named row with a site_id as different shops", () => {
    const log = [
      row({ id: "r1", site_id: null, name: "Shop A" }),
      row({ id: "r2", site_id: "site-1", name: "Shop A" }),
    ];

    expect(latestStatusPerShop(log)).toHaveLength(2);
  });

  it("returns an empty array for an empty log, not an error", () => {
    expect(latestStatusPerShop([])).toEqual([]);
  });

  it("returns every shop unchanged when each has exactly one row", () => {
    const log = [row({ id: "r1", name: "Shop A" }), row({ id: "r2", name: "Shop B" })];
    expect(latestStatusPerShop(log).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});
