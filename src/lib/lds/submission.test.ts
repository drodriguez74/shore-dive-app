import { describe, expect, it } from "vitest";
import {
  MAX_SHOP_NAME_LENGTH,
  classifyLdsInsertFailure,
  parseLdsSubmissionBody,
  toCoordinateNumber,
} from "./submission";

/**
 * Coverage for the LDS submit route's only real branching logic (Task 16 —
 * replacing the localStorage-only stand-in with a real `lds_status` insert).
 *
 * The provenance/`created_by` cases below are the load-bearing ones: they're
 * the app-layer half of CLAUDE.md's "no unmoderated write path to
 * provenance-tagged data" standard, backing up `lds_status_insert_own`'s
 * `with check (created_by = auth.uid() and provenance = 'COMMUNITY')`.
 */

const validBody = {
  site_id: null,
  name: "Test Dive Shop",
  latitude: 26.1224,
  longitude: -80.1373,
  status: "open",
};

describe("parseLdsSubmissionBody", () => {
  it("accepts a well-formed body and normalizes it to insertable columns", () => {
    const result = parseLdsSubmissionBody(validBody);

    expect(result).toEqual({
      ok: true,
      value: {
        site_id: null,
        name: "Test Dive Shop",
        latitude: 26.1224,
        longitude: -80.1373,
        status: "open",
      },
    });
  });

  it("never surfaces a client-supplied provenance or created_by", () => {
    // The whole point of the parsed type: even if a client sends these, the
    // route physically cannot forward them, because they don't exist on the
    // value it gets back. Ignored rather than rejected — see the module
    // header on why.
    const result = parseLdsSubmissionBody({
      ...validBody,
      provenance: "VERIFIED",
      created_by: "00000000-0000-4000-8000-000000000000",
      id: "spoofed-id",
      last_verified_at: "2099-01-01T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual([
      "latitude",
      "longitude",
      "name",
      "site_id",
      "status",
    ]);
    expect(result.value).not.toHaveProperty("provenance");
    expect(result.value).not.toHaveProperty("created_by");
    expect(result.value).not.toHaveProperty("last_verified_at");
  });

  it.each([
    ["null", null],
    ["an array", [validBody]],
    ["a string", "name=Test"],
    ["a number", 7],
  ])("rejects a body that is %s", (_label, body) => {
    const result = parseLdsSubmissionBody(body);
    expect(result.ok).toBe(false);
  });

  it("trims the shop name", () => {
    const result = parseLdsSubmissionBody({ ...validBody, name: "  Blue Water Divers \n" });
    expect(result.ok && result.value.name).toBe("Blue Water Divers");
  });

  it("rejects a missing, blank, or whitespace-only shop name", () => {
    expect(parseLdsSubmissionBody({ ...validBody, name: undefined }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, name: "" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, name: "   " }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, name: 42 }).ok).toBe(false);
  });

  it("rejects a shop name past the length cap but accepts one exactly at it", () => {
    expect(parseLdsSubmissionBody({ ...validBody, name: "a".repeat(MAX_SHOP_NAME_LENGTH) }).ok).toBe(true);
    expect(parseLdsSubmissionBody({ ...validBody, name: "a".repeat(MAX_SHOP_NAME_LENGTH + 1) }).ok).toBe(
      false,
    );
  });

  it("treats absent, null, and empty-string site_id as 'no linked site'", () => {
    for (const siteId of [undefined, null, ""]) {
      const result = parseLdsSubmissionBody({ ...validBody, site_id: siteId });
      expect(result.ok && result.value.site_id).toBeNull();
    }
  });

  it("accepts a UUID site_id and rejects a malformed one", () => {
    const uuid = "3f1a7c0e-1b2d-4e5f-8a9b-0c1d2e3f4a5b";
    expect(parseLdsSubmissionBody({ ...validBody, site_id: uuid }).ok).toBe(true);
    expect(parseLdsSubmissionBody({ ...validBody, site_id: "not-a-uuid" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, site_id: 12345 }).ok).toBe(false);
  });

  it("rejects coordinates outside the table's own check constraints", () => {
    expect(parseLdsSubmissionBody({ ...validBody, latitude: 90.1 }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, latitude: -91 }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, longitude: 180.5 }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, longitude: -181 }).ok).toBe(false);
    // Exact bounds are valid — the constraint is inclusive.
    expect(parseLdsSubmissionBody({ ...validBody, latitude: 90, longitude: -180 }).ok).toBe(true);
  });

  it("rejects non-numeric, NaN, and Infinite coordinates rather than coercing them", () => {
    expect(parseLdsSubmissionBody({ ...validBody, latitude: "26.1224" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, longitude: "" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, latitude: Number.NaN }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, longitude: Number.POSITIVE_INFINITY }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, latitude: null }).ok).toBe(false);
  });

  it("accepts every status the UI can offer and nothing else", () => {
    for (const status of ["open", "limited", "closed", "unknown"]) {
      expect(parseLdsSubmissionBody({ ...validBody, status }).ok).toBe(true);
    }
    expect(parseLdsSubmissionBody({ ...validBody, status: "OPEN" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, status: "verified" }).ok).toBe(false);
    expect(parseLdsSubmissionBody({ ...validBody, status: undefined }).ok).toBe(false);
  });
});

describe("classifyLdsInsertFailure", () => {
  it("maps the rate-limit trigger's exception to 429 and passes its message through", () => {
    const triggerMessage =
      "Rate limit exceeded: you can submit at most 5 row(s) to lds_status per 10 minute(s). Please wait before submitting again.";

    const result = classifyLdsInsertFailure("P0001", triggerMessage);

    expect(result.status).toBe(429);
    expect(result.error).toBe(triggerMessage);
    expect(result.event).toBe("lds_submit.rate_limited");
  });

  it("falls back to a readable message when the rate-limit error carries none", () => {
    expect(classifyLdsInsertFailure("P0001", "").error).toMatch(/wait a few minutes/i);
    expect(classifyLdsInsertFailure("P0001", null).status).toBe(429);
  });

  it("maps an RLS denial to 403, an unknown site to 400, and a check violation to 400", () => {
    expect(classifyLdsInsertFailure("42501", "new row violates row-level security policy").status).toBe(403);
    expect(classifyLdsInsertFailure("23503", "violates foreign key constraint").status).toBe(400);
    expect(classifyLdsInsertFailure("23514", "violates check constraint").status).toBe(400);
  });

  it("never leaks the underlying database message on an unclassified failure", () => {
    const result = classifyLdsInsertFailure("XX000", 'relation "lds_status" does not exist');

    expect(result.status).toBe(500);
    expect(result.error).toBe("Couldn't save your report — try again.");
    expect(result.event).toBe("lds_submit.insert_failed");
  });

  it("treats a missing error code as an unclassified server failure", () => {
    expect(classifyLdsInsertFailure(undefined, "boom").status).toBe(500);
    expect(classifyLdsInsertFailure(null, null).status).toBe(500);
  });
});

describe("toCoordinateNumber", () => {
  it("passes numbers through and coerces PostgREST's numeric-as-string form", () => {
    expect(toCoordinateNumber(26.1224)).toBe(26.1224);
    expect(toCoordinateNumber("26.122400")).toBe(26.1224);
    expect(toCoordinateNumber("-80.137300")).toBe(-80.1373);
  });
});
