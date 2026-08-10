/**
 * Extracts a human-readable message from an unknown caught value. Handles
 * both real `Error` instances and Supabase/PostgREST error objects (plain
 * `{message, code, details, hint}` shapes, not `Error` instances) — a naive
 * `error instanceof Error ? error.message : String(error)` produces the
 * useless "[object Object]" for the latter, a real bug caught live
 * 2026-08-08 in a structured-logger call that was supposed to explain why a
 * DB call failed. Was duplicated (with this exact bug) across 14+ call
 * sites before being consolidated here — import this instead of writing a
 * new local copy.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
