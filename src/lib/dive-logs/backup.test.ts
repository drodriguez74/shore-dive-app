import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backUpDiveLogs,
  fetchBackedUpDiveLogs,
  toBackupRow,
  type DiveLogBackupClient,
  type DiveLogBackupRow,
} from "./backup";
import type { DiveLogEntry } from "@/lib/voice-logging/types";

const ENTRY = {
  id: "entry-1",
  loggedAt: Date.UTC(2026, 10, 11, 12),
  siteId: null,
  site: "Blue Heron Bridge",
  buddy: "Sam",
  notes: "",
  marineLife: ["octopus"],
  transcript: "we went down to thirty feet",
} as unknown as DiveLogEntry;

function fakeClient(options: {
  userId?: string | null;
  upsertError?: { message: string; code?: string } | null;
  rows?: { entry: unknown }[];
  selectError?: { message: string; code?: string } | null;
}) {
  const upserted: DiveLogBackupRow[][] = [];
  const client: DiveLogBackupClient = {
    auth: {
      getUser: async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? "user-1" } } }),
    },
    from: () => ({
      upsert: async (rows) => {
        upserted.push(rows);
        return { error: options.upsertError ?? null };
      },
      select: () => ({
        order: () => ({
          limit: async () => ({ data: options.rows ?? [], error: options.selectError ?? null }),
        }),
      }),
    }),
  };
  return { client, upserted };
}

describe("dive log backup", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("never uploads the raw voice transcript", () => {
    const row = toBackupRow("user-1", ENTRY);
    expect(row.entry.transcript).toBeNull();
    expect(JSON.stringify(row)).not.toContain("thirty feet");
    expect(row).toMatchObject({ user_id: "user-1", client_id: "entry-1", logged_at: "2026-11-11T12:00:00.000Z" });
  });

  it("upserts the diver's entries under their own user id", async () => {
    const { client, upserted } = fakeClient({});
    expect(await backUpDiveLogs(client, [ENTRY])).toEqual({ ok: true, count: 1 });
    expect(upserted[0][0].user_id).toBe("user-1");
  });

  it("does nothing when signed out", async () => {
    const { client, upserted } = fakeClient({ userId: null });
    expect(await backUpDiveLogs(client, [ENTRY])).toEqual({ ok: false, reason: "signed-out" });
    expect(upserted).toHaveLength(0);
  });

  it("reports a missing table as unavailable, other errors as failed", async () => {
    const missing = fakeClient({ upsertError: { message: "not found", code: "PGRST205" } });
    expect(await backUpDiveLogs(missing.client, [ENTRY])).toEqual({ ok: false, reason: "unavailable" });

    const other = fakeClient({ upsertError: { message: "boom", code: "500" } });
    expect(await backUpDiveLogs(other.client, [ENTRY])).toEqual({ ok: false, reason: "failed" });
  });

  it("never throws when the client does", async () => {
    const { client } = fakeClient({});
    client.auth.getUser = async () => {
      throw new Error("offline");
    };
    expect(await backUpDiveLogs(client, [ENTRY])).toEqual({ ok: false, reason: "failed" });
    expect(await fetchBackedUpDiveLogs(client)).toEqual({ ok: false, reason: "failed" });
  });

  it("returns backed-up entries for restore", async () => {
    const { client } = fakeClient({ rows: [{ entry: { id: "a" } }, { entry: { id: "b" } }] });
    expect(await fetchBackedUpDiveLogs(client)).toEqual({ ok: true, entries: [{ id: "a" }, { id: "b" }] });
  });
});
