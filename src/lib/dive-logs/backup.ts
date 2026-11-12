import { errorMessage } from "@/lib/error-message";
import { createLogger } from "@/lib/logger";
import type { DiveLogEntry } from "@/lib/voice-logging/types";

/**
 * Opt-in account backup for dive logs (`dive_logs`, migration 0017). Local
 * storage stays the source of truth; this copies entries to the diver's
 * account and can copy them back. Nothing here throws.
 */

const logger = createLogger("dive-logs");

export type BackupFailureReason = "signed-out" | "unavailable" | "failed";

export type BackupResult = { ok: true; count: number } | { ok: false; reason: BackupFailureReason };
export type RestoreResult = { ok: true; entries: unknown[] } | { ok: false; reason: BackupFailureReason };

interface QueryError {
  message: string;
  code?: string;
}

/** The slice of the Supabase browser client this module uses — kept narrow so tests can fake it. */
export interface DiveLogBackupClient {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: "dive_logs") => {
    upsert: (rows: DiveLogBackupRow[], options: { onConflict: string }) => PromiseLike<{ error: QueryError | null }>;
    select: (columns: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        limit: (count: number) => PromiseLike<{ data: { entry: unknown }[] | null; error: QueryError | null }>;
      };
    };
  };
}

export interface DiveLogBackupRow {
  user_id: string;
  client_id: string;
  logged_at: string;
  entry: Omit<DiveLogEntry, "transcript"> & { transcript: null };
}

const RESTORE_LIMIT = 200;

/** The raw voice transcript never leaves the device (see the voice-logging privacy disclosure). */
export function toBackupRow(userId: string, entry: DiveLogEntry): DiveLogBackupRow {
  return {
    user_id: userId,
    client_id: entry.id,
    logged_at: new Date(entry.loggedAt).toISOString(),
    entry: { ...entry, transcript: null },
  };
}

/** The table doesn't exist until the founder applies migration 0017 — report that distinctly. */
function failureReason(error: QueryError): BackupFailureReason {
  return error.code === "PGRST205" || error.code === "42P01" ? "unavailable" : "failed";
}

async function currentUserId(client: DiveLogBackupClient): Promise<string | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user?.id ?? null;
}

export async function backUpDiveLogs(client: DiveLogBackupClient, entries: DiveLogEntry[]): Promise<BackupResult> {
  try {
    const userId = await currentUserId(client);
    if (!userId) return { ok: false, reason: "signed-out" };
    if (entries.length === 0) return { ok: true, count: 0 };

    const { error } = await client
      .from("dive_logs")
      .upsert(
        entries.map((entry) => toBackupRow(userId, entry)),
        { onConflict: "user_id,client_id" },
      );
    if (error) {
      logger.warn("backup.upsert_failed", { code: error.code, error: errorMessage(error) });
      return { ok: false, reason: failureReason(error) };
    }
    return { ok: true, count: entries.length };
  } catch (error) {
    logger.warn("backup.threw", { error: errorMessage(error) });
    return { ok: false, reason: "failed" };
  }
}

export async function fetchBackedUpDiveLogs(client: DiveLogBackupClient): Promise<RestoreResult> {
  try {
    const userId = await currentUserId(client);
    if (!userId) return { ok: false, reason: "signed-out" };

    const { data, error } = await client
      .from("dive_logs")
      .select("entry")
      .order("logged_at", { ascending: false })
      .limit(RESTORE_LIMIT);
    if (error) {
      logger.warn("restore.select_failed", { code: error.code, error: errorMessage(error) });
      return { ok: false, reason: failureReason(error) };
    }
    return { ok: true, entries: (data ?? []).map((row) => row.entry) };
  } catch (error) {
    logger.warn("restore.threw", { error: errorMessage(error) });
    return { ok: false, reason: "failed" };
  }
}

const PREFERENCE_KEY = "shore-dive:dive-log-backup:enabled:v1";

/** Off unless the diver turned it on, on this device. */
export function isBackupEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setBackupEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, String(enabled));
  } catch (error) {
    logger.warn("preference.write_failed", { error: errorMessage(error) });
  }
}
