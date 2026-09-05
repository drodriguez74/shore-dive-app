/**
 * Display formatting for voice-logging screens.
 *
 * `src/lib/safe-return/format.ts`'s `formatDuration()` is **reused, not
 * reimplemented**, for the "0:52 recording" summary in mockup 03 — its
 * unpadded `M:SS` output already matches that mockup exactly.
 *
 * The one thing it can't cover is mockup 02's large live elapsed display,
 * which is zero-padded (`00:47`, not `0:47`). That difference is not
 * cosmetic churn: DESIGN_SYSTEM.md §3 requires `tabular-nums` "everywhere a
 * number changes over time, so digits don't jitter the layout," and an
 * unpadded minute field re-flows the whole 46px display the moment a
 * recording crosses ten minutes — defeating the point of tabular figures.
 * Hence one small padded variant here, rather than changing the shared
 * Safe-Return helper (whose own countdown deliberately reads `9:59`).
 */

import { formatDuration } from "@/lib/safe-return/format";
import { EXPOSURE_SUIT_OPTIONS, type ExposureSuit } from "./types";

/** `MM:SS`, zero-padded, for the live recording display. Clamps negatives to zero. */
export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/** "0:52 recording" — mockup 03's processing-screen summary. */
export function formatRecordingSummary(ms: number): string {
  return `${formatDuration(ms)} recording`;
}

/** "58 ft", or an em dash when unset. */
export function formatDepthFt(value: number | null): string {
  return value === null ? "—" : `${value} ft`;
}

/** "40 min" / "1h 10m", or an em dash when unset. */
export function formatRuntimeMinutes(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * "3000 → 500 psi", or one honest half when only one was recorded.
 *
 * A half-known pair renders as "3000 psi in" / "500 psi out" rather than
 * padding the missing side with a dash inside the arrow form. "3000 → — psi"
 * reads as a recorded dive with an unreadable second number; "3000 psi in"
 * says plainly that one figure is all there is, which is the truth.
 */
export function formatTankPressure(startPsi: number | null, endPsi: number | null): string {
  if (startPsi !== null && endPsi !== null) return `${startPsi} → ${endPsi} psi`;
  if (startPsi !== null) return `${startPsi} psi in`;
  if (endPsi !== null) return `${endPsi} psi out`;
  return "—";
}

/** "68°F", or an em dash when unset. */
export function formatWaterTempF(value: number | null): string {
  return value === null ? "—" : `${value}°F`;
}

/** "Wetsuit", or an em dash when unset. */
export function formatExposureSuit(value: ExposureSuit | null): string {
  if (value === null) return "—";
  return EXPOSURE_SUIT_OPTIONS.find((option) => option.value === value)?.label ?? "—";
}
