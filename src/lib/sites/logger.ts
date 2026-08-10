/**
 * Minimal structured logger scoped to the `sites`/dive-plan feature
 * (Task 11.5). The wider app doesn't have a shared logger yet (see
 * CLAUDE.md's Engineering standards — "use a consistent structured logger,
 * not ad-hoc console.log"). Mirrors `src/lib/camera-sources/logger.ts`'s
 * shape exactly (itself mirroring `src/lib/safe-return/logger.ts`) so a
 * future shared logger can replace every one of these call sites the same
 * way, rather than each feature inventing its own shape.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "sites",
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
