/**
 * Minimal structured logger scoped to the webcam-extraction feature
 * (Task 18). Mirrors `src/lib/safe-return/logger.ts` and
 * `src/components/media-embed/logger.ts`'s pattern — the wider app doesn't
 * have a shared logger yet (CLAUDE.md's Engineering standards: "use a
 * consistent structured logger, not ad-hoc console.log"), so this is a
 * small, self-contained, feature-scoped stand-in rather than presuming the
 * shape a future project-wide `src/lib/logger.ts` should take. Swap the
 * `emit` sink for a real backend logger later without changing call sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "webcam-extraction",
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
