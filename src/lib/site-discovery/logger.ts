/**
 * Minimal structured logger scoped to the map-pan AI-assisted discovery
 * feature (2026-08-11). Mirrors `src/lib/webcam-extraction/logger.ts` and
 * every other feature-scoped logger in this codebase — no shared
 * project-wide logger exists yet (CLAUDE.md's Engineering standards: "use a
 * consistent structured logger, not ad-hoc console.log").
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "site-discovery",
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
