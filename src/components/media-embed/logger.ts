/**
 * Minimal structured logger scoped to the media-embed feature.
 *
 * The wider app doesn't have a shared logger yet (see CLAUDE.md's
 * Engineering standards — "use a consistent structured logger, not ad-hoc
 * console.log"). This mirrors the same small, self-contained,
 * feature-scoped pattern used by `src/lib/safe-return/logger.ts`, rather
 * than presuming the shape a future project-wide `src/lib/logger.ts`
 * should take. Swap the `emit` sink for a real backend logger later
 * without changing call sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "media-embed",
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
