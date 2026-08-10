/**
 * Minimal structured logger scoped to the Safe-Return feature.
 *
 * The wider app doesn't have a shared logger yet (see CLAUDE.md's Engineering
 * standards — "use a consistent structured logger, not ad-hoc console.log").
 * This is a small, self-contained stand-in for this feature only, deliberately
 * not a project-wide `src/lib/logger.ts`, so it doesn't presume the shape a
 * future shared logger should take. Swap the `emit` sink for a real backend
 * logger later without changing call sites.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "safe-return",
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
