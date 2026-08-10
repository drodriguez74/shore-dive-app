/**
 * Minimal structured logger scoped to the site header / sign-in-sign-out
 * surface. Mirrors `src/lib/safe-return/logger.ts` / `src/lib/camera-sources/
 * logger.ts`'s shape exactly — the wider app doesn't have a shared logger yet
 * (see CLAUDE.md's Engineering standards). Swap the `emit` sink for a real
 * backend logger later without changing call sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "site-header",
    event,
    ...fields,
  };

  const sink =
    level === "debug"
      ? console.debug
      : level === "info"
        ? console.info
        : level === "warn"
          ? console.warn
          : console.error;

  sink(JSON.stringify(entry));
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
