/**
 * Transcript → structured dive-log extraction. Pure, deterministic, offline,
 * and unit-tested field by field.
 *
 * ## Why this is rule-based and not a model call
 *
 * The obvious implementation is "send the transcript to an LLM and ask for
 * JSON" — this repo already does exactly that for webcam telemetry
 * (`src/lib/webcam-extraction/`). It is the wrong choice here, for three
 * independent reasons, any one of which would be sufficient:
 *
 * 1. **Offline.** CLAUDE.md's Pillar 2 treats "the network is unreliable or
 *    absent" as the default case, and voice logging happens at the water's
 *    edge — the precise place the app assumes there is no signal. A
 *    logbook feature that silently requires connectivity to work isn't
 *    "frictionless," it's "log it later and hope you remember," which is
 *    the failure THREAT_MODEL.md §3 opens with.
 * 2. **Cost.** No-budget solo project; the Anthropic API has no free tier
 *    (see `webcam-extraction/model.ts`'s own note), and this would fire on
 *    every single dive rather than on a capped daily schedule.
 * 3. **Privacy.** §3's third finding is a dive buddy's voice reaching a
 *    third party without consent. Shipping the transcript to an inference
 *    API re-creates that exposure after `stt-support.ts` went to some
 *    trouble to bound it.
 *
 * A rule-based extractor is worse at recall than a model would be. That is
 * an acceptable trade *only* because nothing it produces is ever committed
 * without review — see `machine.ts`'s confirm/edit gate. A missed field
 * costs the diver one tap; a hallucinated one would corrupt a logbook.
 *
 * ## Fail-empty, never fail-plausible
 *
 * Every extractor here returns `null` when it isn't confident, and the
 * numeric ones additionally clamp to physically sensible ranges. This is
 * deliberate and is the direct mitigation for THREAT_MODEL.md §3's
 * `"45 feet" heard as "15 feet"` finding: an empty field is visibly empty
 * and gets typed in, whereas a confidently wrong number looks exactly like
 * a correct one. A parse that produces nothing is a success, not a bug.
 *
 * ## What is deliberately NOT extracted
 *
 * - **Site name.** Mockup 04's transcript opens "That was La Jolla Cove,"
 *   and picking that out reliably would need either a gazetteer or a model.
 *   The site is instead pre-filled from real dive-plan context when the
 *   caller has it, and left empty (untagged) otherwise.
 * - **Notes.** Mockup 04 shows a Notes field tagged "Transcribed" with a
 *   summarised sentence that does not appear verbatim in its own transcript
 *   — i.e. the mockup depicts generative summarisation. Producing that
 *   needs a model call, which the three reasons above rule out. Notes is
 *   therefore rendered empty and untagged rather than filled with a
 *   fabricated summary; the full transcript is one tap away in the raw
 *   transcript block directly above it. Flagged as a known, deliberate
 *   deviation from the mockup rather than silently dropped.
 */

import {
  emptyDiveLogDraft,
  type CurrentStrength,
  type DiveLogDraft,
  type DiveLogFieldName,
  type ExposureSuit,
  type VisibilityRating,
} from "./types";

export interface ParsedDiveLog {
  /** The extracted draft. Fields the parser couldn't fill stay at their empty defaults. */
  draft: DiveLogDraft;
  /** Fields the parser actually populated — exactly the ones that earn a "Transcribed" tag. */
  transcribedFields: DiveLogFieldName[];
}

// --- Spoken-number normalisation -----------------------------------------

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};

// "fourty" is not a word, but speech-recognition engines emit it often
// enough that rejecting it would drop real depths on a technicality.
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const MULTIPLIERS: Record<string, number> = { hundred: 100, thousand: 1000 };

const NUMBER_TOKENS = [...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(MULTIPLIERS)];

// Longest-first so "seventeen" is never matched as "seven" + leftover.
const NUMBER_TOKEN_ALTERNATION = [...NUMBER_TOKENS].sort((a, b) => b.length - a.length).join("|");

const NUMBER_RUN_RE = new RegExp(
  `\\b(?:${NUMBER_TOKEN_ALTERNATION})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_TOKEN_ALTERNATION}))*\\b`,
  "gi",
);

// "a hundred and ten" — the indefinite article standing in for one.
// Rewritten before the main pass so the run matcher only ever deals with
// real number words.
const ARTICLE_MULTIPLIER_RE = /\b(?:a|an)([\s-]+)(hundred|thousand)\b/gi;

/**
 * "an hour and ten minutes" — the article standing in for one immediately
 * before a *time* unit.
 *
 * Deliberately limited to time units, not extended to depth units, and the
 * asymmetry is load-bearing rather than an oversight. "An hour" is how
 * people actually state a runtime, so missing it drops a real value. "A
 * foot" is almost never how anyone states a max depth — but it *is* a
 * natural way to describe bad visibility ("about a foot of viz"), and
 * rewriting that to "1 foot" would hand the logbook a 1 ft max depth from a
 * sentence that was talking about something else entirely. Fail-empty beats
 * fail-plausible.
 */
const ARTICLE_TIME_UNIT_RE = /\b(?:a|an)([\s-]+)(hours?|hrs?|minutes?|mins?)\b/gi;

function foldNumberWords(words: string[]): number {
  let total = 0;
  let current = 0;
  let sawAny = false;

  for (const raw of words) {
    const word = raw.toLowerCase();
    if (word === "and" || word === "") continue;

    if (word in ONES) {
      current += ONES[word];
      sawAny = true;
    } else if (word in TENS) {
      current += TENS[word];
      sawAny = true;
    } else if (word === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      sawAny = true;
    } else if (word === "thousand") {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawAny = true;
    }
  }

  return sawAny ? total + current : 0;
}

/**
 * Rewrite spoken number words as digits, in place, leaving everything else
 * untouched: `"down to about fifty five feet"` → `"down to about 55 feet"`.
 *
 * Doing this as a normalisation pass rather than inside each field
 * extractor means depth, runtime, and any future numeric field all get
 * spelled-number support from one tested implementation instead of three
 * partial ones. Exported for direct testing — it carries most of the
 * parser's subtlety.
 */
export function normalizeSpokenNumbers(text: string): string {
  const withArticles = text
    .replace(ARTICLE_MULTIPLIER_RE, (_match, gap: string, multiplier: string) => `one${gap}${multiplier}`)
    .replace(ARTICLE_TIME_UNIT_RE, (_match, gap: string, unit: string) => `one${gap}${unit}`);

  return withArticles.replace(NUMBER_RUN_RE, (match) => {
    const words = match.split(/[\s-]+/);
    const value = foldNumberWords(words);
    // A run that folds to 0 from words that weren't literally "zero" means
    // the fold found nothing it understood — leave the original text alone
    // rather than replacing real words with a misleading "0".
    if (value === 0 && !words.some((w) => w.toLowerCase() === "zero")) return match;
    return String(value);
  });
}

// --- Sentence / clause helpers -------------------------------------------

/**
 * The text immediately preceding `index`, clipped at the nearest sentence
 * boundary.
 *
 * The clipping is load-bearing, not tidiness. Mockup 04's transcript reads
 * `"...stayed under for maybe forty minutes. Saw a garibaldi and what I
 * think was a leopard shark..."`. A fixed-width lookbehind from "garibaldi"
 * reaches back into the previous sentence and finds "maybe", which would
 * hedge a sighting the diver stated plainly. Stopping at the full stop is
 * what makes hedge detection mean anything.
 */
function precedingContext(text: string, index: number, maxChars = 60): string {
  const start = Math.max(0, index - maxChars);
  const window = text.slice(start, index);
  const lastBoundary = Math.max(window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"));
  return lastBoundary === -1 ? window : window.slice(lastBoundary + 1);
}

/** Split into comma/semicolon/full-stop clauses, so "X was good, Y was bad" doesn't cross-contaminate. */
function clauses(text: string): string[] {
  return text
    .split(/[.,;!?]+/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

function clauseContaining(text: string, keywords: RegExp): string | null {
  for (const clause of clauses(text)) {
    if (keywords.test(clause)) return clause;
  }
  return null;
}

// --- Depth ----------------------------------------------------------------

const FEET_PER_METER = 3.28084;

/** Physically sensible bounds for a *shore* dive log. Anything outside is a misparse, not a record. */
const MIN_DEPTH_FT = 1;
const MAX_DEPTH_FT = 1000;

// Longest unit alternatives first, so "meters" never partially matches "m".
const DEPTH_MEASURE_RE = /(\d+(?:\.\d+)?)\s*(?:-\s*)?(feet|foot|ft|metres|meters|metre|meter|m)\b/gi;

const DEPTH_CUE_RE = /\b(?:deep|depth|down|bottom(?:ed)?|max(?:imum)?|descend(?:ed)?|hit)\b/i;

interface Measurement {
  valueFt: number;
  cued: boolean;
}

function toFeet(value: number, unit: string): number {
  const metric = /^m(?:etre|eter)?s?$/i.test(unit);
  return metric ? value * FEET_PER_METER : value;
}

/**
 * Max depth in whole feet, or null.
 *
 * Metric input is converted rather than stored as-spoken: a logbook holding
 * unlabelled mixed units is precisely the silent corruption §3 warns about,
 * and "18" meaning metres in one entry and feet in the next is unrecoverable
 * later.
 *
 * When several measurements appear, one with a nearby depth cue wins over
 * one without; among equals the largest wins, since the field is *max*
 * depth ("we were at 30, then dropped to 55" should log 55).
 */
export function parseMaxDepthFt(normalized: string): number | null {
  const found: Measurement[] = [];

  for (const match of normalized.matchAll(DEPTH_MEASURE_RE)) {
    const raw = Number.parseFloat(match[1]);
    if (!Number.isFinite(raw)) continue;
    const unit = match[2];
    // A bare "m" is ambiguous enough (metres? the start of a cut-off word?)
    // that it only counts when a depth cue vouches for it.
    const context = precedingContext(normalized, match.index ?? 0);
    const cued = DEPTH_CUE_RE.test(context);
    if (/^m$/i.test(unit) && !cued) continue;
    found.push({ valueFt: toFeet(raw, unit), cued });
  }

  if (found.length === 0) return null;

  const cued = found.filter((m) => m.cued);
  const pool = cued.length > 0 ? cued : found;
  const best = Math.round(Math.max(...pool.map((m) => m.valueFt)));

  return best >= MIN_DEPTH_FT && best <= MAX_DEPTH_FT ? best : null;
}

// --- Runtime --------------------------------------------------------------

const MIN_RUNTIME_MIN = 1;
const MAX_RUNTIME_MIN = 600;

const MINUTES_RE = /(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min)\b/gi;
const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr)\b/gi;
/** A spoken "one oh five" style runtime, or a diver reading their computer: "1:05". */
const CLOCK_RE = /\b(\d{1,2}):([0-5]\d)\b/g;

/**
 * Total runtime in whole minutes, or null.
 *
 * Hours and minutes are summed when both are present ("an hour and ten
 * minutes" → 70) rather than one silently overwriting the other.
 */
export function parseRuntimeMinutes(normalized: string): number | null {
  let minutes = 0;
  let sawAny = false;

  for (const match of normalized.matchAll(HOURS_RE)) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) {
      minutes += value * 60;
      sawAny = true;
    }
  }

  for (const match of normalized.matchAll(MINUTES_RE)) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) {
      minutes += value;
      sawAny = true;
    }
  }

  if (!sawAny) {
    for (const match of normalized.matchAll(CLOCK_RE)) {
      const h = Number.parseInt(match[1], 10);
      const m = Number.parseInt(match[2], 10);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        minutes += h * 60 + m;
        sawAny = true;
      }
    }
  }

  if (!sawAny) return null;

  const rounded = Math.round(minutes);
  return rounded >= MIN_RUNTIME_MIN && rounded <= MAX_RUNTIME_MIN ? rounded : null;
}

// --- Tank pressure --------------------------------------------------------

const PSI_PER_BAR = 14.5038;

/**
 * Plausible cylinder pressures in psi. An aluminium 80 fills to ~3000 and a
 * diver surfaces on a reserve that can legitimately be a couple of hundred,
 * so the window is wide; anything outside it is a misparse, not a record.
 */
const MIN_TANK_PSI = 100;
const MAX_TANK_PSI = 5000;

/**
 * Units that mark a number as a pressure. `pounds` is deliberately **not**
 * here even though divers do say it for psi: weight is also stated in pounds
 * ("16 pounds of lead"), and a weight-belt number silently logged as a tank
 * pressure is exactly the fail-plausible outcome this parser exists to
 * avoid.
 */
const TANK_UNIT = String.raw`psi|p\.s\.i\.?|bars?`;

/** "3000 to 500 psi", "3000 psi down to 500". A unit on either side is enough. */
const TANK_RANGE_RE = new RegExp(
  String.raw`(\d{2,4}(?:\.\d+)?)\s*(${TANK_UNIT})?\s*(?:down\s+)?(?:to|through|→|->)\s*(\d{2,4}(?:\.\d+)?)\s*(${TANK_UNIT})?`,
  "gi",
);

const TANK_MEASURE_RE = new RegExp(String.raw`(\d{2,4}(?:\.\d+)?)\s*(${TANK_UNIT})?`, "gi");

/**
 * Units that prove a number is *not* a pressure. Checked against the text
 * immediately following an unqualified number, so "started with 40 minutes
 * of deco" can't be read as a 40 psi starting pressure on the strength of
 * its "started with" cue alone.
 */
const NON_PRESSURE_FOLLOWER_RE =
  /^\s*(?:feet|foot|ft|metres|meters|metre|meter|m|minutes|minute|mins|min|hours|hour|hrs|hr|degrees|degree|deg|°|mil|mm|millimetres|millimeters|pounds|pound|lbs|lb)\b/i;

const TANK_START_CUE_RE =
  /\b(?:start(?:ed|ing)?(?:\s+(?:out|off))?\s*(?:with|at|on)|starting\s+pressure|went\s+in\s+(?:with|on)|got\s+in\s+(?:with|on)|entered\s+(?:with|on)|jumped\s+in\s+(?:with|on)|geared\s+up\s+(?:with|at)|full\s+at)\b/gi;

const TANK_END_CUE_RE =
  /\b(?:came\s+(?:up|back|out)\s+(?:with|on)|come\s+up\s+with|got\s+out\s+(?:with|on)|surfaced\s+(?:with|on)|ended?\s+(?:with|at|on)|ending\s+pressure|finished\s+(?:with|on)|left\s+with|back\s+(?:on\s+board\s+)?with|exited\s+with)\b/gi;

function toPsi(value: number, unit: string | undefined): number {
  return unit !== undefined && /^bars?$/i.test(unit) ? value * PSI_PER_BAR : value;
}

function inTankRange(psi: number): boolean {
  return psi >= MIN_TANK_PSI && psi <= MAX_TANK_PSI;
}

function lastCueIndex(context: string, cue: RegExp): number {
  let last = -1;
  // A fresh RegExp per call: these are module-level /g patterns and sharing
  // `lastIndex` across calls would make results depend on call order.
  for (const match of context.matchAll(new RegExp(cue.source, cue.flags))) {
    last = Math.max(last, match.index ?? 0);
  }
  return last;
}

export interface ParsedTankPressure {
  startPsi: number | null;
  endPsi: number | null;
}

/**
 * Starting and ending cylinder pressure in whole psi.
 *
 * Two independent results, and **either may be null on its own**: a diver
 * who says "went in with 3000" and never mentions surfacing pressure has
 * given a real, partial fact. `plan.md` calls air consumption "the primary
 * self-tracked safety/gear metric after depth/time", and half of it is worth
 * more than none of it.
 *
 * A bare number only counts when a start/end cue vouches for it; a number
 * carrying an explicit psi/bar unit counts on its own. When the preceding
 * text contains both a start and an end cue — "started with 3000, came up
 * with 500" — the *nearest* cue wins, which is what makes that single
 * sentence resolve to two different fields rather than to one twice.
 *
 * Metric `bar` is converted to psi rather than stored as spoken, the same
 * discipline `parseMaxDepthFt` applies to metres.
 *
 * **A start below the end is rejected outright rather than swapped.** You
 * cannot surface with more gas than you entered with, so such a pair is
 * evidence the parse went wrong — and silently reordering it would be the
 * parser inventing an interpretation of a sentence it plainly misread.
 * Fail-empty, never fail-plausible.
 */
export function parseTankPressurePsi(normalized: string): ParsedTankPressure {
  let startPsi: number | null = null;
  let endPsi: number | null = null;

  for (const match of normalized.matchAll(TANK_RANGE_RE)) {
    const [, rawStart, unitStart, rawEnd, unitEnd] = match;
    // Neither side labelled means this is some other range entirely ("we
    // were at 30 to 40 feet"), not a pressure.
    if (unitStart === undefined && unitEnd === undefined) continue;
    const start = toPsi(Number.parseFloat(rawStart), unitStart ?? unitEnd);
    const end = toPsi(Number.parseFloat(rawEnd), unitEnd ?? unitStart);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!inTankRange(start) || !inTankRange(end)) continue;
    startPsi = Math.round(start);
    endPsi = Math.round(end);
    break;
  }

  if (startPsi === null && endPsi === null) {
    for (const match of normalized.matchAll(TANK_MEASURE_RE)) {
      const raw = Number.parseFloat(match[1]);
      if (!Number.isFinite(raw)) continue;
      const unit = match[2];
      const index = match.index ?? 0;

      if (unit === undefined && NON_PRESSURE_FOLLOWER_RE.test(normalized.slice(index + match[0].length))) {
        continue;
      }

      const context = precedingContext(normalized, index);
      const startAt = lastCueIndex(context, TANK_START_CUE_RE);
      const endAt = lastCueIndex(context, TANK_END_CUE_RE);
      if (startAt === -1 && endAt === -1 && unit === undefined) continue;

      const psi = Math.round(toPsi(raw, unit));
      if (!inTankRange(psi)) continue;

      // Nearest cue wins. With no cue at all, an explicitly-labelled number
      // fills whichever slot is still empty, start first — "3000 psi" alone
      // is a starting pressure far more often than a surfacing one.
      if (endAt > startAt) {
        endPsi ??= psi;
      } else if (startAt > -1) {
        startPsi ??= psi;
      } else if (startPsi === null) {
        startPsi = psi;
      } else {
        endPsi ??= psi;
      }
    }
  }

  if (startPsi !== null && endPsi !== null && startPsi < endPsi) {
    return { startPsi: null, endPsi: null };
  }

  return { startPsi, endPsi };
}

// --- Water temperature ----------------------------------------------------

/** Liquid seawater, roughly. Outside this is a misparse. */
const MIN_WATER_TEMP_F = 28;
const MAX_WATER_TEMP_F = 100;

/**
 * The window in which a bare, scale-less "68 degrees" is safely readable as
 * Fahrenheit.
 *
 * Below 40 °F the same number is just as plausibly Celsius — "20 degrees"
 * is 68 °F to most of the world and lethal ice water read as Fahrenheit —
 * and nothing in a transcript resolves that. Rather than guess a locale the
 * app doesn't know, an ambiguous bare value is dropped and the diver types
 * it. An explicit scale ("20 celsius", "68 F") is always honoured and always
 * converted.
 */
const BARE_DEGREES_MIN_F = 40;
const BARE_DEGREES_MAX_F = 95;

const TEMP_SCALED_RE =
  /(-?\d+(?:\.\d+)?)\s*(?:°\s*|degrees?\s*|deg\s*)?(fahrenheit|celsius|centigrade|[fc])\b/gi;
const TEMP_BARE_RE = /(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)\b/gi;

const WATER_TEMP_CUE_RE = /\b(?:water|temp(?:erature)?|thermocline|cold|warm|chilly|balmy|freezing)\b/i;

function celsiusToF(value: number): number {
  return value * (9 / 5) + 32;
}

/**
 * Water temperature in whole °F, or null.
 *
 * °F is the stored unit because this app is imperial throughout (`ft` for
 * depth, `psi` for pressure); a spoken Celsius value is converted at parse
 * time for the same reason a metric depth is.
 */
export function parseWaterTempF(normalized: string): number | null {
  for (const match of normalized.matchAll(TEMP_SCALED_RE)) {
    const raw = Number.parseFloat(match[1]);
    if (!Number.isFinite(raw)) continue;
    const scale = match[2].toLowerCase();
    const isCelsius = scale === "celsius" || scale === "centigrade" || scale === "c";
    const fahrenheit = Math.round(isCelsius ? celsiusToF(raw) : raw);
    if (fahrenheit >= MIN_WATER_TEMP_F && fahrenheit <= MAX_WATER_TEMP_F) return fahrenheit;
  }

  for (const match of normalized.matchAll(TEMP_BARE_RE)) {
    const raw = Number.parseFloat(match[1]);
    if (!Number.isFinite(raw)) continue;
    // A bare number needs a temperature-ish word somewhere in the sentence
    // before it counts — "degrees" alone can be a compass bearing.
    const context = precedingContext(normalized, match.index ?? 0, 80);
    if (!WATER_TEMP_CUE_RE.test(context)) continue;
    const fahrenheit = Math.round(raw);
    if (fahrenheit >= BARE_DEGREES_MIN_F && fahrenheit <= BARE_DEGREES_MAX_F) return fahrenheit;
  }

  return null;
}

// --- Exposure suit --------------------------------------------------------

/**
 * Suit phrases, scanned in order. Negations sit at the top so "didn't wear a
 * wetsuit" resolves to `none` instead of being swallowed by the `wetsuit`
 * entry sitting inside it — the same ordering property the visibility table
 * depends on, and asserted directly in the tests for the same reason.
 *
 * A bare "skin" is deliberately absent: it is an ordinary English word
 * ("my skin was freezing") and matching it would manufacture sightings of a
 * garment nobody mentioned. Only the unambiguous compounds count.
 */
const EXPOSURE_SUIT_PHRASES: readonly { phrase: RegExp; suit: ExposureSuit }[] = [
  { phrase: /\b(?:no|without\s+a|without)\s+(?:wet\s*suit|dry\s*suit|suit|exposure\s+protection)\b/i, suit: "none" },
  // "wetsuit" is one word, so a trailing `\bsuit\b` would never fire inside
  // it — the garment alternatives have to be spelled out.
  {
    phrase:
      /\b(?:did\s?n[o']?t|didnt|was\s?n[o']?t|wasnt)\s+(?:wear|wearing)\b[^.,;!?]{0,24}(?:wet\s*suit|dry\s*suit|\bsuit)\b/i,
    suit: "none",
  },
  { phrase: /\b(?:board\s*shorts|swim\s*(?:suit|trunks)|bathing\s+suit|just\s+a\s+swimsuit)\b/i, suit: "none" },
  { phrase: /\bdry\s*suit\b/i, suit: "drysuit" },
  { phrase: /\b(?:shorty|shortie|shorties)\b/i, suit: "shorty" },
  { phrase: /\bwet\s*suit\b/i, suit: "wetsuit" },
  { phrase: /\b(?:dive\s+skin|skin\s+suit|rash\s*guard|lycra)\b/i, suit: "skin" },
  // A stated thickness is only ever a neoprene wetsuit in practice, and
  // "7 mil" is how divers actually say it — worth catching, but only after
  // every explicit garment name above has had its chance.
  { phrase: /\b\d+(?:\.\d+)?\s*(?:mil|mm|millimet(?:re|er)s?)\b/i, suit: "wetsuit" },
];

/** Exposure protection worn, or null. */
export function parseExposureSuit(normalized: string): ExposureSuit | null {
  for (const entry of EXPOSURE_SUIT_PHRASES) {
    if (entry.phrase.test(normalized)) return entry.suit;
  }
  return null;
}

// --- Buddy ----------------------------------------------------------------

const BUDDY_CUE_RE =
  /\b(?:(?:my|dive|our)\s+)?(?:buddy|dive\s+buddy|partner)\b(?:'s\s+name)?\s*(?:was|is|were)?\s*[:,]?\s+|\b(?:diving|dove|dived|buddied\s+up|paired\s+up|teamed\s+up|went\s+out|was\s+out|buddied)\s+with\s+/gi;

/**
 * Capitalised words that are never a buddy's name. Pronouns and connectives
 * lead the list because "dove with I", "buddy was The", and "diving with
 * Saturday" are exactly what a naive capitalised-token grab produces.
 */
const NOT_A_NAME = new Set(
  [
    "i", "we", "he", "she", "they", "you", "it", "me", "us", "them", "myself",
    "the", "a", "an", "and", "but", "then", "also", "after", "before", "about",
    "my", "his", "her", "their", "our", "some", "someone", "somebody", "everyone",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december",
    "visibility", "viz", "vis", "current", "water", "depth", "runtime", "max",
    "saw", "went", "got", "had", "was", "were", "no", "nobody", "none", "solo",
  ],
);

const NAME_TOKEN = String.raw`[A-Z][a-zA-Z'’\-]{1,20}`;
const BUDDY_NAME_RE = new RegExp(String.raw`^(${NAME_TOKEN})(?:\s+and\s+(${NAME_TOKEN}))?`);

/**
 * A possessive is never the buddy: "diving with Dave's brother" names the
 * brother, and "Saturday's group" names nobody at all. Rejecting the whole
 * token also stops a possessive slipping past the blocklist, which matches
 * on bare words and would never see "saturday's".
 */
const POSSESSIVE_RE = /['’]s$/i;

function isName(token: string | undefined): token is string {
  if (token === undefined) return false;
  if (POSSESSIVE_RE.test(token)) return false;
  return !NOT_A_NAME.has(token.toLowerCase());
}

/**
 * The dive buddy's name, or null.
 *
 * **Capitalisation is required, and that is the whole safety mechanism.**
 * There is no gazetteer of first names to check against and no model to ask,
 * so the only signal separating "my buddy Dave" from "my buddy was great" is
 * that a speech engine capitalises what it believes is a proper noun. Engines
 * are inconsistent about this, so real names will be missed — accepted
 * deliberately, because the alternative (taking whatever word follows the
 * cue) writes "Was" and "Great" into a logbook field, and a wrong name
 * attached to a dive is worse than an empty one the diver fills in.
 *
 * Reads the **original** transcript, not the number-normalised one, since
 * that casing is the entire signal.
 *
 * Two names joined by "and" are both kept — a three-person team is ordinary
 * — with each half checked against the same blocklist, so "Dave and I"
 * yields "Dave" rather than "Dave and I".
 */
export function parseBuddyName(text: string): string | null {
  for (const match of text.matchAll(BUDDY_CUE_RE)) {
    const rest = text.slice((match.index ?? 0) + match[0].length);
    const name = BUDDY_NAME_RE.exec(rest);
    if (!name) continue;

    const [, first, second] = name;
    if (!isName(first)) continue;
    return isName(second) ? `${first} and ${second}` : first;
  }

  return null;
}

// --- Marine life ----------------------------------------------------------

/**
 * Curated sighting vocabulary. A closed list, not open-ended noun
 * extraction: the point is high precision on things a diver would actually
 * log, since a wrong sighting is noise the diver has to notice and delete.
 *
 * Scenery is deliberately excluded — "kelp", "reef", "wreck", "sand". This
 * matches mockup 04, whose transcript says "near the kelp" and whose Marine
 * life field lists only Garibaldi and Leopard shark. Habitat is where the
 * dive happened, not something seen.
 *
 * Multi-word entries are matched before their single-word substrings, so
 * "leopard shark" never also registers a bare "shark".
 */
const MARINE_LIFE_TERMS: readonly string[] = [
  // Sharks & rays
  "goliath grouper", "whale shark", "nurse shark", "leopard shark", "hammerhead shark", "hammerhead",
  "reef shark", "bull shark", "sand shark", "horn shark", "shark",
  "spotted eagle ray", "eagle ray", "manta ray", "bat ray", "stingray", "sting ray", "ray",
  // Eels
  "green moray", "moray eel", "moray", "garden eel", "eel",
  // Reptiles & mammals
  "sea turtle", "green turtle", "loggerhead", "hawksbill", "turtle",
  "sea lion", "harbor seal", "harbour seal", "dolphin", "manatee", "seal",
  // Invertebrates
  "spiny lobster", "lobster", "octopus", "squid", "cuttlefish", "nudibranch", "sea hare",
  "sea star", "starfish", "brittle star", "sea urchin", "urchin", "crab", "shrimp",
  "jellyfish", "moon jelly", "sea slug", "anemone", "scallop",
  // Fish
  "garibaldi", "sheephead", "kelp bass", "calico bass", "halibut", "rockfish", "lingcod",
  "barracuda", "grouper", "snapper", "tarpon", "snook", "permit", "amberjack", "cobia",
  "angelfish", "parrotfish", "butterflyfish", "triggerfish", "pufferfish", "trumpetfish",
  "lionfish", "scorpionfish", "seahorse", "flounder", "wrasse", "goby", "blenny", "grunt",
  "surgeonfish", "tang", "batfish", "cowfish", "filefish", "hogfish", "spadefish",
];

const MARINE_LIFE_SORTED = [...MARINE_LIFE_TERMS].sort((a, b) => b.length - a.length);

/**
 * Hedges the diver used about an ID. Preserved into the label ("Leopard
 * shark (maybe)") rather than dropped, because an uncertain sighting the
 * diver flagged as uncertain should stay uncertain in the logbook — the
 * same instinct behind the `MODEL_INFERRED` provenance tier.
 */
const HEDGE_RE = /\b(?:maybe|might(?:\s+have)?|possibly|probably|i\s+think|think\s+(?:it|that)\s+was|not\s+sure|could\s+have\s+been|looked\s+like|some\s+kind\s+of|pretty\s+sure)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Sighting labels found in the transcript, in the order they were spoken.
 *
 * Overlap suppression: once a span is claimed by a longer term, a shorter
 * term inside it is skipped — so "leopard shark" yields one entry, not
 * "Leopard shark" plus a stray "Shark".
 */
export function parseMarineLife(text: string): string[] {
  const haystack = text.toLowerCase();
  const claimed: { start: number; end: number }[] = [];
  const found: { index: number; label: string }[] = [];

  for (const term of MARINE_LIFE_SORTED) {
    const re = new RegExp(`\\b${escapeRegExp(term)}(?:e?s)?\\b`, "gi");
    for (const match of haystack.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (claimed.some((span) => start < span.end && end > span.start)) continue;
      claimed.push({ start, end });

      const hedged = HEDGE_RE.test(precedingContext(text, start));
      found.push({ index: start, label: `${titleCaseFirst(term)}${hedged ? " (maybe)" : ""}` });
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .filter((entry) => {
      const key = entry.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => entry.label);
}

// --- Visibility & current -------------------------------------------------

/**
 * Descriptor → rating tables.
 *
 * Ordered longest-phrase-first within each list and scanned in that order
 * across the whole table, so a negation like "not great" resolves to `fair`
 * instead of being swallowed by the `great` → `good` entry sitting inside
 * it. That ordering is asserted directly in the tests, because it is the
 * kind of thing an innocuous-looking future edit silently breaks.
 */
const VISIBILITY_DESCRIPTORS: readonly { phrase: string; rating: VisibilityRating }[] = [
  { phrase: "not great", rating: "fair" },
  { phrase: "not good", rating: "fair" },
  { phrase: "not amazing", rating: "fair" },
  { phrase: "crystal clear", rating: "excellent" },
  { phrase: "gin clear", rating: "excellent" },
  { phrase: "blown out", rating: "poor" },
  { phrase: "green soup", rating: "poor" },
  { phrase: "pea soup", rating: "poor" },
  { phrase: "zero viz", rating: "poor" },
  { phrase: "excellent", rating: "excellent" },
  { phrase: "incredible", rating: "excellent" },
  { phrase: "spectacular", rating: "excellent" },
  { phrase: "amazing", rating: "excellent" },
  { phrase: "terrible", rating: "poor" },
  { phrase: "horrible", rating: "poor" },
  { phrase: "average", rating: "fair" },
  { phrase: "moderate", rating: "fair" },
  { phrase: "middling", rating: "fair" },
  { phrase: "murky", rating: "poor" },
  { phrase: "silty", rating: "poor" },
  { phrase: "milky", rating: "poor" },
  { phrase: "decent", rating: "good" },
  { phrase: "great", rating: "good" },
  { phrase: "solid", rating: "good" },
  { phrase: "clear", rating: "good" },
  { phrase: "good", rating: "good" },
  { phrase: "nice", rating: "good" },
  { phrase: "poor", rating: "poor" },
  { phrase: "awful", rating: "poor" },
  { phrase: "bad", rating: "poor" },
  { phrase: "okay", rating: "fair" },
  { phrase: "fair", rating: "fair" },
  { phrase: "so-so", rating: "fair" },
  { phrase: "ok", rating: "fair" },
];

const CURRENT_DESCRIPTORS: readonly { phrase: string; strength: CurrentStrength }[] = [
  { phrase: "no current", strength: "none" },
  { phrase: "not much", strength: "none" },
  { phrase: "washing machine", strength: "strong" },
  { phrase: "picking up", strength: "moderate" },
  { phrase: "noticeable", strength: "moderate" },
  { phrase: "a little", strength: "mild" },
  { phrase: "ripping", strength: "strong" },
  { phrase: "moderate", strength: "moderate" },
  { phrase: "medium", strength: "moderate" },
  { phrase: "nonexistent", strength: "none" },
  { phrase: "none", strength: "none" },
  { phrase: "calm", strength: "none" },
  { phrase: "still", strength: "none" },
  { phrase: "slack", strength: "none" },
  { phrase: "flat", strength: "none" },
  { phrase: "strong", strength: "strong" },
  { phrase: "heavy", strength: "strong" },
  { phrase: "rough", strength: "strong" },
  { phrase: "ripping", strength: "strong" },
  { phrase: "gentle", strength: "mild" },
  { phrase: "slight", strength: "mild" },
  { phrase: "light", strength: "mild" },
  { phrase: "mild", strength: "mild" },
  { phrase: "some", strength: "mild" },
];

const VISIBILITY_KEYWORD_RE = /\b(?:visibility|viz|vis)\b/i;
const CURRENT_KEYWORD_RE = /\bcurrents?\b/i;

function matchDescriptor<T>(clause: string, table: readonly { phrase: string; rating?: T; strength?: T }[]): T | null {
  const haystack = clause.toLowerCase();
  for (const entry of table) {
    const re = new RegExp(`\\b${escapeRegExp(entry.phrase)}\\b`, "i");
    if (re.test(haystack)) {
      return (entry.rating ?? entry.strength) as T;
    }
  }
  return null;
}

/**
 * Visibility rating, or null.
 *
 * Scoped to the clause that actually mentions visibility, so
 * `"visibility was decent, current was rough"` cannot read "rough" as a
 * visibility descriptor.
 */
export function parseVisibility(text: string): VisibilityRating | null {
  const clause = clauseContaining(text, VISIBILITY_KEYWORD_RE);
  if (!clause) return null;
  return matchDescriptor<VisibilityRating>(clause, VISIBILITY_DESCRIPTORS);
}

/** Current strength, or null. Clause-scoped for the same reason as visibility. */
export function parseCurrent(text: string): CurrentStrength | null {
  const clause = clauseContaining(text, CURRENT_KEYWORD_RE);
  if (!clause) return null;
  return matchDescriptor<CurrentStrength>(clause, CURRENT_DESCRIPTORS);
}

// --- Top-level ------------------------------------------------------------

export interface ParseDiveLogOptions {
  /** Site name from real dive-plan context, if any. Pre-filled, never tagged "Transcribed". */
  site?: string;
}

/**
 * Extract a structured draft from a transcript.
 *
 * `transcribedFields` lists only the fields actually populated *from the
 * transcript* — `site` is excluded even when pre-filled, because it came
 * from dive-plan context rather than from anything the diver said, and
 * mislabelling its origin would undermine the tags everywhere else.
 */
export function parseDiveLogTranscript(transcript: string, options: ParseDiveLogOptions = {}): ParsedDiveLog {
  const draft = emptyDiveLogDraft(options.site ?? "");
  const transcribedFields: DiveLogFieldName[] = [];

  const trimmed = transcript.trim();
  if (trimmed === "") return { draft, transcribedFields };

  const normalized = normalizeSpokenNumbers(trimmed);

  // Buddy reads the original transcript: capitalisation is the only signal
  // separating a name from an ordinary word, and it must not be disturbed.
  const buddy = parseBuddyName(trimmed);
  if (buddy !== null) {
    draft.buddy = buddy;
    transcribedFields.push("buddy");
  }

  const maxDepthFt = parseMaxDepthFt(normalized);
  if (maxDepthFt !== null) {
    draft.maxDepthFt = maxDepthFt;
    transcribedFields.push("maxDepthFt");
  }

  const runtimeMinutes = parseRuntimeMinutes(normalized);
  if (runtimeMinutes !== null) {
    draft.runtimeMinutes = runtimeMinutes;
    transcribedFields.push("runtimeMinutes");
  }

  // One field, two numbers: the row earns a single "Transcribed" tag if the
  // parser filled either half, matching how `field-tags.ts` compares it.
  const { startPsi, endPsi } = parseTankPressurePsi(normalized);
  if (startPsi !== null || endPsi !== null) {
    draft.tankPressureStartPsi = startPsi;
    draft.tankPressureEndPsi = endPsi;
    transcribedFields.push("tankPressure");
  }

  const waterTempF = parseWaterTempF(normalized);
  if (waterTempF !== null) {
    draft.waterTempF = waterTempF;
    transcribedFields.push("waterTempF");
  }

  const exposureSuit = parseExposureSuit(normalized);
  if (exposureSuit !== null) {
    draft.exposureSuit = exposureSuit;
    transcribedFields.push("exposureSuit");
  }

  // Marine life reads the *original* transcript, not the normalised one:
  // number normalisation can rewrite words inside a species name ("one
  // spot" style constructions) and gains nothing here.
  const marineLife = parseMarineLife(trimmed);
  if (marineLife.length > 0) {
    draft.marineLife = marineLife;
    transcribedFields.push("marineLife");
  }

  const visibility = parseVisibility(trimmed);
  if (visibility !== null) {
    draft.visibility = visibility;
    transcribedFields.push("visibility");
  }

  const current = parseCurrent(trimmed);
  if (current !== null) {
    draft.current = current;
    transcribedFields.push("current");
  }

  return { draft, transcribedFields };
}
