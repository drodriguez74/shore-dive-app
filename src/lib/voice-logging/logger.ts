/**
 * Structured logger scoped to the voice-logging feature.
 *
 * Same shape and rationale as `src/components/post-dive-prompt/logger.ts`
 * and `src/lib/safe-return/logger.ts`: feature-scoped rather than a
 * project-wide `src/lib/logger.ts`, because this repo doesn't have a shared
 * one yet (CLAUDE.md's Engineering standards call for "a consistent
 * structured logger" but the consolidation hasn't happened). Kept as an
 * independent copy so each feature stays independently swappable when a
 * real shared logger lands.
 *
 * ## Never log transcript content
 *
 * This feature's log fields are deliberately limited to shapes and codes —
 * transcript *length*, field *names*, error *codes*, elapsed *durations*.
 * The transcript itself can contain a dive buddy's name, a bystander's
 * remark, or a site a diver would rather not broadcast, and THREAT_MODEL.md
 * §3 flags exactly that content reaching a third party as the privacy risk
 * of this pillar. A console log is not a third party today, but it is one
 * the moment any error-reporting integration lands, and by then the call
 * sites would already be written. So the rule is enforced now, while it's
 * free.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "voice-logging",
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
