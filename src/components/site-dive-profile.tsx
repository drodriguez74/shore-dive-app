/**
 * "Can I dive this, and how would I get in?" — the depth/certification and
 * shore-access sections of the site detail page (T21.22).
 *
 * The founder's framing for this page is that it is **not** only a shore
 * diver's page: a reader may be evaluating a site they'd reach by boat
 * charter, or deciding whether to pursue the certification for it. So this
 * component is written to be genuinely informative about a site the reader
 * *cannot currently dive* — a technical-depth wreck is labelled plainly as a
 * technical dive and explained, not hidden, and a site with no shore entry
 * says so without pretending that settles how divers reach it.
 *
 * ## What may and may not be claimed here
 *
 * Both source modules are explicit about this in their own headers, and this
 * component is the place those rules become visible copy. Read
 * `src/lib/sites/shore-access.ts` and `src/lib/sites/dive-suitability.ts`
 * before changing a word below.
 *
 * - **Shore access is never presented as confirmed.** The classification is a
 *   distance measurement against a hand-curated list of real entry points, and
 *   distance is dominated in practice by current, surf, visibility, boat
 *   traffic, entry footing and the diver's own fitness — none of which are in
 *   this data. The wording is "plausibly shore-accessible — verify
 *   conditions", never "shore dive: confirmed".
 * - **The `marginal` tier reads as a real swim.** It means a site near the
 *   outer edge of the measured baseline (up to ~0.5 mi / 880 yd from the
 *   entry), which is a 20-30 minute surface swim each way — not a stroll off
 *   the beach. Rendering `likely` and `marginal` identically would be the
 *   single most misleading thing this component could do.
 * - **"No known shore entry" is not "boat-only".** `classifyShoreAccess`
 *   returns `unlikely` both for genuinely offshore sites and for sites whose
 *   entry point nobody has catalogued yet, and its own header forbids callers
 *   from rendering the second case as though it were the first.
 * - **Certification suitability is guidance for filtering a map, never
 *   permission.** "Within Open Water training depth", never "you can dive
 *   this". Limits differ by agency and by whether a diver holds a deep
 *   specialty.
 * - **Unknown depth renders as "not recorded", never as a level** — and never
 *   as an implication that the site is shallow.
 * - **The diver-down flag notice is a legal requirement, not a tip**, so it is
 *   surfaced for every shore-accessible site rather than left to per-site
 *   notes most sites will never have.
 * - **`classifyShoreAccess` is a coastal-distance model and must not run
 *   against a walk-in freshwater site.** Found 2026-08-10 verifying Task
 *   22's spring research: this component called it unconditionally, so a
 *   spring's own coordinates (often hundreds of miles from any catalogued
 *   Atlantic entry) produced a real but nonsensical result — "the nearest
 *   shore entry on file is 300+ mi away... divers most likely reach this
 *   site by boat or charter" on a walk-in spring's own page. Gated on
 *   `usesCoastalDistanceModel(site.site_type)` (`./water-access.ts`), same
 *   as `shore-access.ts`'s own documented scope; walk-in sites render from
 *   `classifyWaterAccess()` and the site's own stored `shore_access`
 *   instead (see `WalkInAccessBody`).
 *
 * A note on `CERTIFICATION_LABEL`: it is used verbatim for `open_water`,
 * `advanced_open_water` and for the *entirely* beyond-recreational case, where
 * it is exactly right. It is deliberately NOT used for the band between 100 ft
 * and 130 ft, where `minimumLevel` is already `deep_specialty` but
 * `entirelyBeyondRecreational` is still false — printing "Beyond recreational
 * limits" there would be wrong: that depth is still inside the 130 ft
 * recreational limit for a diver with deep training. That band gets its own
 * phrasing below.
 */

import {
  classifyDiveSuitability,
  CERTIFICATION_LABEL,
  ADVANCED_OPEN_WATER_MAX_FT,
  OPEN_WATER_MAX_FT,
  RECREATIONAL_MAX_FT,
} from "@/lib/sites/dive-suitability";
import {
  classifyShoreAccess,
  FLORIDA_DIVER_DOWN_FLAG_NOTICE,
  SHORE_DIVE_MAX_MILES,
  type ShoreAccessResult,
} from "@/lib/sites/shore-access";
import { classifyWaterAccess, usesCoastalDistanceModel, type WaterAccess } from "@/lib/sites/water-access";
import { classifyDiveDifficulty, DIFFICULTY_LABEL, type DifficultyLevel } from "@/lib/sites/dive-difficulty";
import { resolveSiteDepthFt, type DepthCarryingSite } from "@/lib/sites/site-depth";
import type { ShoreAccessConfidence, SiteType } from "@/lib/sites/types";

export interface SiteDiveProfileProps {
  site: DepthCarryingSite & {
    name: string;
    latitude: number;
    longitude: number;
    site_type?: SiteType | null;
    shore_access?: ShoreAccessConfidence | null;
  };
}

export function SiteDiveProfile({ site }: SiteDiveProfileProps) {
  const depth = resolveSiteDepthFt(site);
  const suitability = classifyDiveSuitability({ minFt: depth.minFt, maxFt: depth.maxFt });
  const water = classifyWaterAccess(site.site_type);
  // `classifyShoreAccess` measures distance to a *coastal* entry point — see
  // this component's header note (2026-08-10). Never call it for a walk-in
  // freshwater site; `usesCoastalDistanceModel` is the same gate
  // `shore-access.ts`'s own docs point callers at.
  const isWalkInSite = !usesCoastalDistanceModel(site.site_type);
  const shore = isWalkInSite ? null : classifyShoreAccess({ latitude: site.latitude, longitude: site.longitude });
  const difficulty = classifyDiveDifficulty(
    { latitude: site.latitude, longitude: site.longitude },
    { minFt: depth.minFt, maxFt: depth.maxFt },
    site.site_type,
  );

  const isTechnical = suitability.entirelyBeyondRecreational;
  const isDeepSpecialtyBand = !isTechnical && suitability.minimumLevel === "deep_specialty";

  let depthHeadline: string;
  if (suitability.minimumLevel === null) {
    depthHeadline = "Depth not recorded";
  } else if (isTechnical) {
    // Literal, not interpolated from CERTIFICATION_LABEL. This headline once
    // built itself from the `deep_specialty` label; when that label was
    // corrected to say "still within recreational limits" (which is true of
    // the 100-130 ft band it names), this line started reading "Technical
    // dive — ... still within recreational limits" — a direct contradiction
    // on the most safety-relevant line on the page. The two states are
    // genuinely different claims and must not share a string.
    depthHeadline = "Technical dive — beyond recreational limits";
  } else if (isDeepSpecialtyBand) {
    depthHeadline = "Deeper than Advanced Open Water training depth";
  } else {
    depthHeadline = `Within ${CERTIFICATION_LABEL[suitability.minimumLevel]} training depth`;
  }

  return (
    <>
      {water.overheadWarning && (
        <div
          role="alert"
          className="rounded-lg border border-red-600/30 bg-red-500/5 p-3 dark:border-red-400/30 dark:bg-red-500/10"
        >
          <p className="text-xs font-semibold text-red-800 dark:text-red-300">
            {water.overhead === "cave" ? "Overhead environment — cave" : "Overhead environment — cavern"}
          </p>
          <p className="mt-1 text-xs text-red-900/80 dark:text-red-200/80">{water.overheadWarning}</p>
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Dive difficulty</h2>
        <DiveDifficultyBody level={difficulty.level} riskFactors={difficulty.riskFactors} summary={difficulty.summary} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Depth &amp; certification</h2>

        <div>
          <p className="text-sm font-medium text-black dark:text-zinc-50">{depthHeadline}</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{suitability.summary}</p>
        </div>

        {suitability.minimumLevel === null && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            No depth is on file for this site, so there is no certification guidance to give. That is missing
            data, not a sign the site is shallow.
          </p>
        )}

        {isDeepSpecialtyBand && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Still inside the {RECREATIONAL_MAX_FT} ft recreational limit, but deeper than a standard Advanced
            Open Water course covers — this is deep-specialty territory.
          </p>
        )}

        {isTechnical && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Listed here because it is worth knowing about — divers do reach sites like this, by boat, with
            technical training, gas planning and equipment beyond recreational scuba. It is not a dive to work
            up to on an Open Water or Advanced Open Water certification.
          </p>
        )}

        {depth.source === "description" && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Depth read from the imported source text{depth.rawText ? ` (“${depth.rawText}”)` : ""} — a reported
            figure that nobody has surveyed or reviewed.
          </p>
        )}

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Training depths used here are the widely-taught recreational limits — {OPEN_WATER_MAX_FT} ft Open
          Water, {ADVANCED_OPEN_WATER_MAX_FT} ft Advanced Open Water, {RECREATIONAL_MAX_FT} ft recreational
          limit. They are guidance for filtering a map, not permission to dive: limits differ by agency and by
          whether you hold a deep specialty, and conditions matter more than any number here.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Shore access</h2>
        {isWalkInSite ? (
          <WalkInAccessBody water={water} shoreAccess={site.shore_access} />
        ) : (
          <ShoreAccessBody shore={shore!} />
        )}

        {(shore?.isShoreAccessible || (isWalkInSite && site.shore_access !== "unlikely")) && (
          <div className="rounded-lg border border-amber-600/20 bg-amber-500/5 p-3 dark:border-amber-400/20">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Legal requirement — diver-down flag
            </p>
            <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
              {FLORIDA_DIVER_DOWN_FLAG_NOTICE}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Distance to a shore entry, in the unit a diver actually thinks in. Under
 * half a mile that is yards (the unit every local shore-dive write-up uses —
 * "the second reef is about half a mile out", "300 yd"); beyond that, miles,
 * because a yard count in the thousands stops meaning anything.
 *
 * Yards are rounded to 10 to avoid implying survey precision from a
 * great-circle calculation against a hand-placed entry coordinate.
 */
export function formatShoreDistance(miles: number): string {
  if (miles < 0.5) {
    const yards = Math.round((miles * 1760) / 10) * 10;
    return `${yards} yd`;
  }
  return `${miles.toFixed(1)} mi`;
}

const DIFFICULTY_BADGE_CLASSES: Record<DifficultyLevel, string> = {
  beginner: "bg-emerald-500/10 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
  intermediate: "bg-blue-500/10 text-blue-800 dark:bg-blue-400/10 dark:text-blue-300",
  advanced: "bg-amber-500/10 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  technical: "bg-red-500/10 text-red-800 dark:bg-red-400/10 dark:text-red-300",
};

/**
 * `classifyDiveDifficulty`'s own header sets the rule this component exists
 * to enforce: `riskFactors` is rendered every time `level` is, never a bare
 * badge. An unexplained "Advanced" label reads as a verdict; the factor list
 * is what turns it into a measurement a diver can check against their own
 * judgement.
 */
function DiveDifficultyBody({
  level,
  riskFactors,
  summary,
}: {
  level: DifficultyLevel | null;
  riskFactors: string[];
  summary: string;
}) {
  if (level === null) {
    return (
      <div>
        <p className="text-sm font-medium text-black dark:text-zinc-50">Not enough data to assess</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{summary}</p>
      </div>
    );
  }

  return (
    <div>
      <span
        className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${DIFFICULTY_BADGE_CLASSES[level]}`}
      >
        {DIFFICULTY_LABEL[level]}
      </span>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{summary}</p>
      {riskFactors.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-zinc-500 dark:text-zinc-400">
          {riskFactors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
        Based only on depth, overhead environment and swim distance — not a safety rating. Current, visibility,
        surf and your own fitness decide whether a dive is actually easy on any given day.
      </p>
    </div>
  );
}

/**
 * Shore access for a walk-in freshwater site (spring/cave) — `water.summary`
 * plus the site's own stored `shore_access`, never `classifyShoreAccess`
 * (see this component's header note). Most walk-in sites are genuinely
 * easy, no-boat entries; `shore_access: "unlikely"` here means the
 * opposite of what it means for a coastal site — not "too far to swim",
 * but "not open to general recreational diving at all" (a real, found
 * case: Task 22 found 3 springs matching this). Deliberately doesn't name
 * the specific reason — that lives in the site's research summary, if it
 * has one — so this component doesn't need to know it to render honestly.
 */
function WalkInAccessBody({
  water,
  shoreAccess,
}: {
  water: WaterAccess;
  shoreAccess: ShoreAccessConfidence | null | undefined;
}) {
  if (shoreAccess === "unlikely") {
    return (
      <div>
        <p className="text-sm font-medium text-black dark:text-zinc-50">Not open to recreational diving</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This is a walk-in freshwater site, but general access for diving is restricted or unavailable — check
          the notes on this page before planning a trip here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium text-black dark:text-zinc-50">Walk-in freshwater access</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{water.summary}</p>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
        This app&apos;s shore-access distance model is built for coastal reefs and wrecks and doesn&apos;t apply
        here — a spring&apos;s own site rules and any overhead-environment training required (see above) decide
        access, not a swim distance.
      </p>
    </div>
  );
}

function ShoreAccessBody({ shore }: { shore: ShoreAccessResult }) {
  const { confidence, nearestEntry, distanceMiles } = shore;

  // No entry points in range AND none on file at all — genuinely unassessed,
  // which is a different statement from "the nearest one is too far".
  if (!nearestEntry || distanceMiles === null) {
    return (
      <div>
        <p className="text-sm font-medium text-black dark:text-zinc-50">Shore access not assessed</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          No shore entry points are catalogued near here yet, so this app can&apos;t say anything about walking
          in. That is a gap in our data, not evidence the site is boat-only.
        </p>
      </div>
    );
  }

  const distance = formatShoreDistance(distanceMiles);

  if (confidence === "unlikely") {
    return (
      <div>
        <p className="text-sm font-medium text-black dark:text-zinc-50">
          No catalogued shore entry within swimming distance
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The nearest shore entry on file — {nearestEntry.name} — is about {distance} away, past the{" "}
          {SHORE_DIVE_MAX_MILES} mi this app treats as a plausible shore swim. Divers most likely reach this
          site by boat or charter.
        </p>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          This is not a finding that the site is boat-only. Our entry-point list is small and hand-curated, so
          a real walk-in entry we haven&apos;t catalogued yet would produce exactly this result.
        </p>
      </div>
    );
  }

  const isMarginal = confidence === "marginal";

  return (
    <div>
      <p className="text-sm font-medium text-black dark:text-zinc-50">
        {isMarginal
          ? "Plausibly shore-accessible, but a long swim — verify conditions"
          : "Plausibly shore-accessible — verify conditions"}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        About {distance} from {nearestEntry.name}.{" "}
        {isMarginal
          ? "Treat that as a real 20–30 minute surface swim each way, not a stroll off the beach. It sits at the outer edge of what this app counts as a shore dive, and conditions can rule it out on any given day — plenty of divers do this one from a boat instead."
          : "That is well inside the swim distance divers are known to cover from the beach here."}
      </p>
      {nearestEntry.note && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">{nearestEntry.name}:</span>{" "}
          {nearestEntry.note}
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
        Plausible is not confirmed. This is a distance measurement and nothing else — current, surf,
        visibility, boat traffic, entry footing and your own fitness all matter more, and none of them are in
        this data. Check locally before you commit to the swim.
      </p>
    </div>
  );
}
