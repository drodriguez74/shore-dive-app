/**
 * Shared structured logger (CLAUDE.md engineering standards). Emits one JSON
 * line per event so field failures can be reconstructed from logs after the
 * fact. Each feature keeps its own `logger.ts` that just binds a scope.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
}

function emit(scope: string, level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
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

export function createLogger(scope: string): Logger {
  return {
    debug: (event, fields) => emit(scope, "debug", event, fields),
    info: (event, fields) => emit(scope, "info", event, fields),
    warn: (event, fields) => emit(scope, "warn", event, fields),
    error: (event, fields) => emit(scope, "error", event, fields),
  };
}
