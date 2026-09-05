import { describe, expect, it } from "vitest";
import {
  normalizeSpokenNumbers,
  parseBuddyName,
  parseCurrent,
  parseDiveLogTranscript,
  parseExposureSuit,
  parseMarineLife,
  parseMaxDepthFt,
  parseRuntimeMinutes,
  parseTankPressurePsi,
  parseVisibility,
  parseWaterTempF,
} from "./parse-transcript";

/**
 * The transcript rendered in `creative/mockups/voice-logging/04-confirm-edit.html`.
 * Used verbatim as the end-to-end case so the shipped parser is measured
 * against the approved design rather than against examples chosen to suit it.
 */
const MOCKUP_TRANSCRIPT =
  "That was La Jolla Cove, went down to about fifty five feet, stayed under for maybe forty minutes. " +
  "Saw a garibaldi and what I think was a leopard shark near the kelp. Visibility was decent, current was pretty calm.";

describe("normalizeSpokenNumbers", () => {
  it("folds a two-word tens run", () => {
    expect(normalizeSpokenNumbers("about fifty five feet")).toBe("about 55 feet");
  });

  it("handles teens and single units", () => {
    expect(normalizeSpokenNumbers("seventeen meters")).toBe("17 meters");
    expect(normalizeSpokenNumbers("nine minutes")).toBe("9 minutes");
  });

  it("does not mistake 'seventeen' for 'seven'", () => {
    expect(normalizeSpokenNumbers("seventeen")).toBe("17");
  });

  it("folds hundreds, with and without 'and'", () => {
    expect(normalizeSpokenNumbers("one hundred twenty feet")).toBe("120 feet");
    expect(normalizeSpokenNumbers("one hundred and twenty feet")).toBe("120 feet");
  });

  it("reads an indefinite article before a multiplier as one", () => {
    expect(normalizeSpokenNumbers("a hundred feet")).toBe("100 feet");
  });

  it("reads an indefinite article before a time unit as one", () => {
    // Caught by the "an hour and ten minutes" test below, which returned 10
    // before this case was handled — "an hour" carried no digit, so the
    // hours pass found nothing to add.
    expect(normalizeSpokenNumbers("an hour and ten minutes")).toBe("1 hour and 10 minutes");
    expect(normalizeSpokenNumbers("a minute")).toBe("1 minute");
  });

  it("leaves an article before a depth unit alone", () => {
    // "about a foot of viz" is a visibility remark, not a 1 ft max depth.
    // Rewriting it would turn a fail-empty into a fail-plausible.
    expect(normalizeSpokenNumbers("about a foot of viz")).toBe("about a foot of viz");
  });

  it("accepts the common 'fourty' misspelling engines emit", () => {
    expect(normalizeSpokenNumbers("fourty minutes")).toBe("40 minutes");
  });

  it("leaves surrounding words and punctuation untouched", () => {
    expect(normalizeSpokenNumbers("down to forty feet, then up.")).toBe("down to 40 feet, then up.");
  });

  it("preserves a literal spoken zero", () => {
    expect(normalizeSpokenNumbers("zero visibility")).toBe("0 visibility");
  });

  it("leaves text with no number words completely unchanged", () => {
    const text = "Saw a garibaldi near the kelp.";
    expect(normalizeSpokenNumbers(text)).toBe(text);
  });
});

describe("parseMaxDepthFt", () => {
  it("reads a cued imperial depth", () => {
    expect(parseMaxDepthFt("went down to about 55 feet")).toBe(55);
  });

  it("accepts common unit abbreviations", () => {
    expect(parseMaxDepthFt("max depth 60 ft")).toBe(60);
    expect(parseMaxDepthFt("we hit 60 foot")).toBe(60);
  });

  it("converts metric depths to feet rather than storing them ambiguously", () => {
    // A logbook holding unlabelled mixed units is the silent corruption
    // THREAT_MODEL.md §3 warns about — 18 meaning metres in one entry and
    // feet in the next is unrecoverable later.
    expect(parseMaxDepthFt("down to 18 meters")).toBe(59);
    expect(parseMaxDepthFt("depth was 18 metres")).toBe(59);
  });

  it("takes the deepest measurement, since the field is max depth", () => {
    expect(parseMaxDepthFt("we were down at 30 feet then dropped to 55 feet")).toBe(55);
  });

  it("prefers a cued measurement over an uncued one even when the uncued one is larger", () => {
    // "80 feet of line" is not a depth; "down to 40 feet" is.
    expect(parseMaxDepthFt("paid out 80 feet of line, went down to 40 feet")).toBe(40);
  });

  it("only accepts a bare 'm' when a depth cue vouches for it", () => {
    expect(parseMaxDepthFt("down to 20 m")).toBe(66);
    expect(parseMaxDepthFt("swam past 20 m of reef")).toBeNull();
  });

  it("does not read a runtime as a depth", () => {
    expect(parseMaxDepthFt("stayed under for 40 minutes")).toBeNull();
  });

  it("returns null rather than a guess when nothing matches", () => {
    // Fail-empty is a success here: an empty field is visibly empty and
    // gets typed in, whereas a confidently wrong depth looks correct.
    expect(parseMaxDepthFt("great dive, saw a turtle")).toBeNull();
    expect(parseMaxDepthFt("")).toBeNull();
  });

  it("rejects physically implausible results instead of recording them", () => {
    expect(parseMaxDepthFt("down to 5000 feet")).toBeNull();
    expect(parseMaxDepthFt("down to 0 feet")).toBeNull();
  });

  it("does not turn 'about a foot of viz' into a 1 ft max depth", () => {
    expect(parseMaxDepthFt(normalizeSpokenNumbers("visibility was about a foot"))).toBeNull();
  });
});

describe("parseRuntimeMinutes", () => {
  it("reads plain minutes", () => {
    expect(parseRuntimeMinutes("stayed under for 40 minutes")).toBe(40);
    expect(parseRuntimeMinutes("about 45 min")).toBe(45);
  });

  it("converts hours", () => {
    expect(parseRuntimeMinutes("we were down for 1 hour")).toBe(60);
  });

  it("sums hours and minutes rather than letting one overwrite the other", () => {
    expect(parseRuntimeMinutes(normalizeSpokenNumbers("an hour and ten minutes"))).toBe(70);
  });

  it("reads a dive-computer style clock reading", () => {
    expect(parseRuntimeMinutes("runtime was 1:05")).toBe(65);
  });

  it("does not read a depth as a runtime", () => {
    expect(parseRuntimeMinutes("down to 55 feet")).toBeNull();
  });

  it("does not mistake 'min' inside another word for a unit", () => {
    expect(parseRuntimeMinutes("40 mineral deposits")).toBeNull();
  });

  it("rejects implausible runtimes", () => {
    expect(parseRuntimeMinutes("under for 900 minutes")).toBeNull();
  });

  it("returns null when there's nothing to read", () => {
    expect(parseRuntimeMinutes("nice dive")).toBeNull();
  });
});

describe("parseTankPressurePsi", () => {
  it("reads a start and an end from one spoken sentence", () => {
    // The nearest-cue rule doing its job: both cues sit in the text before
    // "500", and only the closer one may claim it.
    expect(parseTankPressurePsi("started with 3000 and came up with 500")).toEqual({
      startPsi: 3000,
      endPsi: 500,
    });
  });

  it("reads the spoken range form", () => {
    expect(parseTankPressurePsi("3000 to 500 psi")).toEqual({ startPsi: 3000, endPsi: 500 });
    expect(parseTankPressurePsi("3000 psi down to 500")).toEqual({ startPsi: 3000, endPsi: 500 });
  });

  it("keeps a start with no end, rather than rejecting a partial memory", () => {
    // plan.md calls air consumption "the primary self-tracked safety/gear
    // metric after depth/time" — half of it beats none of it, and a diver
    // who only remembers the fill pressure has still said something true.
    expect(parseTankPressurePsi("went in with 3000 psi")).toEqual({ startPsi: 3000, endPsi: null });
  });

  it("keeps an end with no start", () => {
    expect(parseTankPressurePsi("came up with 500 psi")).toEqual({ startPsi: null, endPsi: 500 });
    expect(parseTankPressurePsi("surfaced with 700 psi")).toEqual({ startPsi: null, endPsi: 700 });
  });

  it("converts bar to psi rather than storing it as spoken", () => {
    // Same discipline parseMaxDepthFt applies to metres: an unlabelled
    // mixed-unit logbook is unrecoverable later.
    expect(parseTankPressurePsi("200 bar to 50 bar")).toEqual({ startPsi: 2901, endPsi: 725 });
  });

  it("rejects a start below the end instead of quietly swapping them", () => {
    // You cannot surface with more gas than you entered with, so this pair
    // is evidence the parse went wrong. Reordering it would be the parser
    // inventing a reading of a sentence it plainly misread.
    expect(parseTankPressurePsi("started with 500 and came up with 3000")).toEqual({
      startPsi: null,
      endPsi: null,
    });
  });

  it("does not read a depth or a runtime as a pressure", () => {
    expect(parseTankPressurePsi("down to 55 feet for 40 minutes")).toEqual({ startPsi: null, endPsi: null });
  });

  it("ignores a cued number that a following unit proves is something else", () => {
    // The cue alone is not enough: "started with 40 minutes of deco" has a
    // start cue and a number, and neither makes it a tank pressure.
    expect(parseTankPressurePsi("started with 40 minutes of deco")).toEqual({ startPsi: null, endPsi: null });
    expect(parseTankPressurePsi("started with 30 feet of line")).toEqual({ startPsi: null, endPsi: null });
  });

  it("ignores an uncued, unlabelled number entirely", () => {
    expect(parseTankPressurePsi("there were 300 of them")).toEqual({ startPsi: null, endPsi: null });
  });

  it("rejects physically implausible pressures", () => {
    expect(parseTankPressurePsi("started with 9000 psi")).toEqual({ startPsi: null, endPsi: null });
  });

  it("returns nulls rather than guessing when nothing matches", () => {
    expect(parseTankPressurePsi("great dive, saw a turtle")).toEqual({ startPsi: null, endPsi: null });
    expect(parseTankPressurePsi("")).toEqual({ startPsi: null, endPsi: null });
  });
});

describe("parseWaterTempF", () => {
  it("reads a bare degrees value in the unambiguous Fahrenheit range", () => {
    expect(parseWaterTempF("water was 68 degrees")).toBe(68);
  });

  it("honours an explicit scale", () => {
    expect(parseWaterTempF("water was 68 degrees F")).toBe(68);
    expect(parseWaterTempF("water temp was 20 celsius")).toBe(68);
  });

  it("drops a bare value that is just as plausibly Celsius", () => {
    // "20 degrees" is 68 °F to most of the world and lethal ice water read
    // as Fahrenheit, and nothing in a transcript resolves that. Guessing a
    // locale the app doesn't know would be fail-plausible.
    expect(parseWaterTempF("water was 20 degrees")).toBeNull();
  });

  it("needs a temperature cue before trusting a bare degrees value", () => {
    // "degrees" on its own can be a compass bearing.
    expect(parseWaterTempF("we swam a heading of 180 degrees")).toBeNull();
  });

  it("does not read a depth in feet as a temperature", () => {
    // The scale-letter branch must not match the "f" of "feet" — the word
    // boundary after [fc] is what prevents it.
    expect(parseWaterTempF("down to 55 feet")).toBeNull();
  });

  it("returns null when no temperature was mentioned", () => {
    expect(parseWaterTempF("the water was nice")).toBeNull();
    expect(parseWaterTempF("")).toBeNull();
  });

  it("rejects temperatures outside liquid seawater", () => {
    expect(parseWaterTempF("water was 200 degrees F")).toBeNull();
  });
});

describe("parseExposureSuit", () => {
  it("reads the named garments", () => {
    expect(parseExposureSuit("wore my wetsuit")).toBe("wetsuit");
    expect(parseExposureSuit("in my drysuit")).toBe("drysuit");
    expect(parseExposureSuit("dry suit day")).toBe("drysuit");
    expect(parseExposureSuit("just a shorty")).toBe("shorty");
    expect(parseExposureSuit("wore a rash guard")).toBe("skin");
  });

  it("resolves a negation to 'none' rather than matching the garment inside it", () => {
    // The same ordering property the visibility descriptor table depends on:
    // "no wetsuit" must not be swallowed by the "wetsuit" entry.
    expect(parseExposureSuit("no wetsuit today")).toBe("none");
    expect(parseExposureSuit("didn't wear a wetsuit")).toBe("none");
    expect(parseExposureSuit("just board shorts")).toBe("none");
  });

  it("reads a stated thickness as a wetsuit", () => {
    expect(parseExposureSuit("7 mil and still cold")).toBe("wetsuit");
    expect(parseExposureSuit(normalizeSpokenNumbers("seven mil hooded"))).toBe("wetsuit");
  });

  it("prefers an explicitly named garment over a thickness", () => {
    expect(parseExposureSuit("7 mil drysuit")).toBe("drysuit");
  });

  it("does not match a bare 'skin', which is an ordinary word", () => {
    expect(parseExposureSuit("my skin was freezing")).toBeNull();
  });

  it("is not fooled by an unrelated 'no' earlier in the sentence", () => {
    expect(parseExposureSuit("there was no current, wore a wetsuit")).toBe("wetsuit");
  });

  it("returns null when no exposure protection was mentioned", () => {
    expect(parseExposureSuit("nice easy dive")).toBeNull();
    expect(parseExposureSuit("")).toBeNull();
  });
});

describe("parseBuddyName", () => {
  it("reads a name after the common cues", () => {
    expect(parseBuddyName("my buddy Dave was with me")).toBe("Dave");
    expect(parseBuddyName("buddy was Dave")).toBe("Dave");
    expect(parseBuddyName("diving with Sarah")).toBe("Sarah");
    expect(parseBuddyName("dove with Marcus today")).toBe("Marcus");
  });

  it("keeps both names of a three-person team", () => {
    expect(parseBuddyName("dove with Dave and Sarah")).toBe("Dave and Sarah");
  });

  it("does not append a pronoun as a second buddy", () => {
    expect(parseBuddyName("dove with Dave and I")).toBe("Dave");
  });

  it("requires capitalisation, which is the whole safety mechanism", () => {
    // With no gazetteer and no model, casing is the only signal separating
    // a name from an ordinary word. Taking whatever follows the cue would
    // write "Was" and "Great" into a logbook.
    expect(parseBuddyName("my buddy was great")).toBeNull();
    expect(parseBuddyName("diving with the group")).toBeNull();
  });

  it("rejects capitalised words that are never names", () => {
    expect(parseBuddyName("diving with Saturday's group")).toBeNull();
    expect(parseBuddyName("buddy was Visibility")).toBeNull();
  });

  it("returns null when no buddy was mentioned", () => {
    expect(parseBuddyName("saw a garibaldi near the kelp")).toBeNull();
    expect(parseBuddyName("")).toBeNull();
  });
});

describe("parseMarineLife", () => {
  it("finds sightings in the order they were spoken", () => {
    expect(parseMarineLife("Saw a garibaldi and then an octopus")).toEqual(["Garibaldi", "Octopus"]);
  });

  it("preserves a hedge the diver actually used", () => {
    expect(parseMarineLife("what I think was a leopard shark")).toEqual(["Leopard shark (maybe)"]);
  });

  it("does not let a hedge bleed across a sentence boundary", () => {
    // The exact hazard the sentence-clipped lookbehind exists for: "maybe"
    // belongs to the previous sentence's runtime, not to the sighting.
    expect(parseMarineLife("stayed under for maybe forty minutes. Saw a garibaldi.")).toEqual(["Garibaldi"]);
  });

  it("matches a longer species name without also emitting its substring", () => {
    expect(parseMarineLife("saw a leopard shark")).toEqual(["Leopard shark"]);
    expect(parseMarineLife("saw an eagle ray")).toEqual(["Eagle ray"]);
  });

  it("still catches a generic sighting when that's all the diver said", () => {
    expect(parseMarineLife("a shark went past")).toEqual(["Shark"]);
  });

  it("handles plurals", () => {
    expect(parseMarineLife("a couple of lobsters")).toEqual(["Lobster"]);
  });

  it("deduplicates repeated mentions", () => {
    expect(parseMarineLife("an octopus, then another octopus")).toEqual(["Octopus"]);
  });

  it("excludes scenery, matching mockup 04's own extraction", () => {
    // The mockup's transcript says "near the kelp" and its Marine life
    // field lists only Garibaldi and Leopard shark. Habitat is where the
    // dive happened, not something seen.
    expect(parseMarineLife("swam through the kelp over the reef and sand")).toEqual([]);
  });

  it("returns an empty list rather than guessing", () => {
    expect(parseMarineLife("nice easy dive, nothing special")).toEqual([]);
  });
});

describe("parseVisibility", () => {
  it("reads a descriptor from the visibility clause", () => {
    expect(parseVisibility("Visibility was decent")).toBe("good");
    expect(parseVisibility("viz was excellent")).toBe("excellent");
    expect(parseVisibility("visibility was murky")).toBe("poor");
  });

  it("resolves a negation to fair rather than being swallowed by the word inside it", () => {
    // "not great" must not match the "great" -> good entry sitting inside
    // it. This is the ordering property the descriptor table is built for.
    expect(parseVisibility("visibility was not great")).toBe("fair");
    expect(parseVisibility("visibility was not good")).toBe("fair");
  });

  it("does not read a descriptor belonging to a different clause", () => {
    expect(parseVisibility("visibility was decent, current was rough")).toBe("good");
  });

  it("returns null when visibility was never mentioned", () => {
    expect(parseVisibility("current was calm")).toBeNull();
  });

  it("returns null when visibility is mentioned with no usable descriptor", () => {
    expect(parseVisibility("visibility was what it was")).toBeNull();
  });
});

describe("parseCurrent", () => {
  it("reads current strength from the current clause", () => {
    expect(parseCurrent("current was pretty calm")).toBe("none");
    expect(parseCurrent("there was a mild current")).toBe("mild");
    expect(parseCurrent("the current was ripping")).toBe("strong");
    expect(parseCurrent("moderate current on the way back")).toBe("moderate");
  });

  it("reads an explicit absence", () => {
    expect(parseCurrent("no current at all")).toBe("none");
  });

  it("does not read a visibility descriptor as a current strength", () => {
    expect(parseCurrent("visibility was rough, current was calm")).toBe("none");
  });

  it("returns null when current was never mentioned", () => {
    expect(parseCurrent("visibility was good")).toBeNull();
  });
});

describe("parseDiveLogTranscript — end to end against the approved mockup", () => {
  const parsed = parseDiveLogTranscript(MOCKUP_TRANSCRIPT);

  it("extracts every field mockup 04 shows as transcribed", () => {
    expect(parsed.draft.maxDepthFt).toBe(55);
    expect(parsed.draft.runtimeMinutes).toBe(40);
    expect(parsed.draft.marineLife).toEqual(["Garibaldi", "Leopard shark (maybe)"]);
    expect(parsed.draft.visibility).toBe("good");
    expect(parsed.draft.current).toBe("none");
  });

  it("tags exactly the fields it populated", () => {
    expect(parsed.transcribedFields).toEqual([
      "maxDepthFt",
      "runtimeMinutes",
      "marineLife",
      "visibility",
      "current",
    ]);
  });

  it("leaves site empty and untagged — it came from context, not speech", () => {
    expect(parsed.draft.site).toBe("");
    expect(parsed.transcribedFields).not.toContain("site");
  });

  it("populates none of the v5 fields the mockup transcript never mentions", () => {
    // The load-bearing negative case for the four fields added by plan.md's
    // v5 correction: this transcript talks about depth in feet and runtime
    // in minutes, and none of those numbers may leak into tank pressure or
    // water temperature. An empty field is a success.
    expect(parsed.draft.buddy).toBe("");
    expect(parsed.draft.tankPressureStartPsi).toBeNull();
    expect(parsed.draft.tankPressureEndPsi).toBeNull();
    expect(parsed.draft.waterTempF).toBeNull();
    expect(parsed.draft.exposureSuit).toBeNull();

    for (const field of ["buddy", "tankPressure", "waterTempF", "exposureSuit"] as const) {
      expect(parsed.transcribedFields).not.toContain(field);
    }
  });

  it("leaves notes empty and untagged rather than fabricating a summary", () => {
    // Deliberate, documented deviation from mockup 04, which depicts a
    // summarised Notes value that appears nowhere in its own transcript —
    // i.e. generative summarisation, which would require a model call.
    expect(parsed.draft.notes).toBe("");
    expect(parsed.transcribedFields).not.toContain("notes");
  });
});

describe("parseDiveLogTranscript — pre-filled site and empty input", () => {
  it("pre-fills a known site without claiming it was transcribed", () => {
    const parsed = parseDiveLogTranscript("down to 40 feet", { site: "Blue Heron Bridge" });
    expect(parsed.draft.site).toBe("Blue Heron Bridge");
    expect(parsed.transcribedFields).toEqual(["maxDepthFt"]);
  });

  it("returns an empty draft with no tags for an empty transcript", () => {
    const parsed = parseDiveLogTranscript("   ");
    expect(parsed.transcribedFields).toEqual([]);
    expect(parsed.draft.maxDepthFt).toBeNull();
  });

  it("returns an empty draft rather than throwing on unrelated speech", () => {
    const parsed = parseDiveLogTranscript("um, so, yeah, that was something else entirely");
    expect(parsed.transcribedFields).toEqual([]);
  });

  it("handles spelled-out numbers end to end", () => {
    const parsed = parseDiveLogTranscript("max depth of thirty two feet for twenty five minutes");
    expect(parsed.draft.maxDepthFt).toBe(32);
    expect(parsed.draft.runtimeMinutes).toBe(25);
  });
});

describe("parseDiveLogTranscript — the v5 fields end to end", () => {
  const TRANSCRIPT =
    "Dove with Marcus, went down to sixty feet for thirty five minutes. " +
    "Started with 3000 psi and came up with 700. Water was 64 degrees, 7 mil wetsuit. " +
    "Visibility was good, current was mild.";

  const parsed = parseDiveLogTranscript(TRANSCRIPT);

  it("extracts every newly added field", () => {
    expect(parsed.draft.buddy).toBe("Marcus");
    expect(parsed.draft.tankPressureStartPsi).toBe(3000);
    expect(parsed.draft.tankPressureEndPsi).toBe(700);
    expect(parsed.draft.waterTempF).toBe(64);
    expect(parsed.draft.exposureSuit).toBe("wetsuit");
  });

  it("still extracts the original four alongside them", () => {
    expect(parsed.draft.maxDepthFt).toBe(60);
    expect(parsed.draft.runtimeMinutes).toBe(35);
    expect(parsed.draft.visibility).toBe("good");
    expect(parsed.draft.current).toBe("mild");
  });

  it("tags every field it populated, in the form's render order", () => {
    // Render order matters: the tags are read down the confirm/edit form,
    // and a lineage list in a different order to the fields it describes is
    // needlessly hard to check against the screen.
    expect(parsed.transcribedFields).toEqual([
      "buddy",
      "maxDepthFt",
      "runtimeMinutes",
      "tankPressure",
      "waterTempF",
      "exposureSuit",
      "visibility",
      "current",
    ]);
  });

  it("tags tank pressure once even though it filled two numbers", () => {
    // One row, one label, one badge — see field-tags.ts's paired comparison.
    expect(parsed.transcribedFields.filter((field) => field === "tankPressure")).toHaveLength(1);
  });

  it("tags tank pressure when only one half was spoken", () => {
    const partial = parseDiveLogTranscript("went in with 3000 psi");
    expect(partial.draft.tankPressureStartPsi).toBe(3000);
    expect(partial.draft.tankPressureEndPsi).toBeNull();
    expect(partial.transcribedFields).toContain("tankPressure");
  });

  it("leaves the new fields empty and untagged when the diver never mentions them", () => {
    const quiet = parseDiveLogTranscript("down to 40 feet for 30 minutes, saw an octopus");
    expect(quiet.draft.buddy).toBe("");
    expect(quiet.draft.tankPressureStartPsi).toBeNull();
    expect(quiet.draft.tankPressureEndPsi).toBeNull();
    expect(quiet.draft.waterTempF).toBeNull();
    expect(quiet.draft.exposureSuit).toBeNull();
    expect(quiet.transcribedFields).toEqual(["maxDepthFt", "runtimeMinutes", "marineLife"]);
  });
});
