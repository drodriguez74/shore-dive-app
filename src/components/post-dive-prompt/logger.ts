/**
 * Minimal structured logger scoped to the Post-Dive Micro-Prompt feature.
 *
 * Adapted from the same pattern used by `src/lib/safe-return/logger.ts`
 * (feature-scoped, not a project-wide `src/lib/logger.ts` — the wider app
 * doesn't have a shared logger yet per CLAUDE.md's Engineering standards).
 * Kept as a separate, independent copy rather than importing the
 * Safe-Return one: that file's own docstring says it's deliberately scoped
 * to that feature, and this task's file-touch scope doesn't include
 * `src/lib/`, so a small local logger here keeps both features
 * independently swappable when a real shared logger eventually lands.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "post-dive-prompt",
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
