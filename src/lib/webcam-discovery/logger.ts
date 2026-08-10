/**
 * Minimal structured logger scoped to the webcam candidate-discovery
 * feature (Task 19.1). Mirrors `src/lib/webcam-extraction/logger.ts` and
 * `src/lib/camera-sources/logger.ts`'s pattern exactly -- the wider app
 * doesn't have a shared logger yet (CLAUDE.md's Engineering standards:
 * "use a consistent structured logger, not ad-hoc console.log"). This is a
 * new feature area, so a new small, self-contained, feature-scoped logger
 * is reasonable rather than reusing another feature's scope label. Swap
 * the `emit` sink for a real backend logger later without changing call
 * sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "webcam-discovery",
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
