// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatShoreDistance, SiteDiveProfile } from "./site-dive-profile";
import { FLORIDA_DIVER_DOWN_FLAG_NOTICE } from "@/lib/sites/shore-access";

/**
 * These are **copy tests**, and that is the point (T21.22).
 *
 * `src/lib/sites/shore-access.ts` and `src/lib/sites/dive-suitability.ts` both
 * state, in their own headers, exactly what may and may not be claimed about
 * their output. Those constraints only exist for a reader if the rendered
 * words honour them, and a rewording that quietly turns "plausibly
 * shore-accessible" into "shore dive" or "within Open Water training depth"
 * into "you can dive this" would break nothing a normal test notices. So the
 * assertions below are deliberately about wording, and the negative ones
 * (`queryByText`, `not.toMatch`) matter more than the positive ones.
 *
 * Coordinates are anchored to `SOUTH_FLORIDA_ENTRY_POINTS`' Datura Avenue
 * entry (26.1867, -80.09498), the documented baseline for both shore-access
 * thresholds. Offsets due east were checked against `classifyShoreAccess`
 * itself: 0.05 mi → `likely`, 0.30 mi → `marginal`, mid-Atlantic → `unlikely`.
 */

const AT_ENTRY = { latitude: 26.1867, longitude: -80.09498 };
const LIKELY = { latitude: 26.1867, longitude: -80.09417 };
const MARGINAL = { latitude: 26.1867, longitude: -80.09013 };
const OFFSHORE = { latitude: 25.0, longitude: -75.0 };

function reportedDepth(depth: string): string {
  return `Automatically imported from OpenStreetMap community map data.\n\nReported depth: ${depth}.`;
}

function renderProfile(overrides: Parameters<typeof SiteDiveProfile>[0]["site"]) {
  return render(<SiteDiveProfile site={overrides} />);
}

afterEach(cleanup);

describe("SiteDiveProfile — shore access copy", () => {
  it("never presents shore access as confirmed", () => {
    renderProfile({ name: "Datura Reef", ...LIKELY });

    expect(screen.getByText(/Plausibly shore-accessible — verify conditions/)).toBeTruthy();
    // The exact phrasings shore-access.ts's header forbids.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/shore dive:?\s*confirmed/i);
    expect(body).toMatch(/Plausible is not confirmed/);
  });

  it("names the conditions the classification does not account for", () => {
    renderProfile({ name: "Datura Reef", ...LIKELY });
    const body = document.body.textContent ?? "";
    for (const factor of ["current", "surf", "visibility", "boat traffic", "entry footing", "your own fitness"]) {
      expect(body).toContain(factor);
    }
  });

  it("reads the marginal tier as a real 20–30 minute surface swim, not a stroll", () => {
    renderProfile({ name: "Second Reef", ...MARGINAL });

    expect(screen.getByText(/Plausibly shore-accessible, but a long swim — verify conditions/)).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/20–30 minute surface swim each way/);
    expect(body).toMatch(/not a stroll off the beach/);
    expect(body).toMatch(/outer edge of what this app counts as a shore dive/);
  });

  it("does not render the likely and marginal tiers identically", () => {
    const { container: likely } = renderProfile({ name: "Close", ...LIKELY });
    const likelyText = likely.textContent ?? "";
    cleanup();
    const { container: marginal } = renderProfile({ name: "Far", ...MARGINAL });
    const marginalText = marginal.textContent ?? "";

    expect(likelyText).not.toEqual(marginalText);
    expect(likelyText).not.toMatch(/20–30 minute/);
    expect(marginalText).toMatch(/20–30 minute/);
  });

  it("shows the distance and the entry point it was measured from", () => {
    renderProfile({ name: "Datura Reef", ...MARGINAL });
    expect(screen.getByText(/About 530 yd from Datura Avenue, Lauderdale-by-the-Sea/)).toBeTruthy();
  });

  it("surfaces the entry point's own restriction note when it has one", () => {
    renderProfile({ name: "Anglin's", ...AT_ENTRY });
    expect(screen.getByText(/300 ft clear of the active pier structure/)).toBeTruthy();
  });

  it("never renders 'no known entry' as 'boat-only'", () => {
    renderProfile({ name: "Deep Wreck", ...OFFSHORE });

    expect(screen.getByText(/No catalogued shore entry within swimming distance/)).toBeTruthy();
    const body = document.body.textContent ?? "";
    // A hedged "most likely reach this site by boat" is allowed; a finding
    // that the site *is* boat-only is not — shore-access.ts's header is
    // explicit that an uncatalogued entry produces the identical result.
    expect(body).toMatch(/This is not a finding that the site is boat-only/);
    expect(body).toMatch(/hand-curated/);
  });
});

describe("SiteDiveProfile — diver-down flag", () => {
  it("surfaces the Florida notice as a legal requirement for shore-accessible sites", () => {
    renderProfile({ name: "Datura Reef", ...LIKELY });
    expect(screen.getByText(/Legal requirement — diver-down flag/)).toBeTruthy();
    expect(screen.getByText(FLORIDA_DIVER_DOWN_FLAG_NOTICE)).toBeTruthy();
  });

  it("also surfaces it for the marginal tier", () => {
    renderProfile({ name: "Second Reef", ...MARGINAL });
    expect(screen.getByText(FLORIDA_DIVER_DOWN_FLAG_NOTICE)).toBeTruthy();
  });

  it("omits it when there is no shore access to caveat", () => {
    renderProfile({ name: "Deep Wreck", ...OFFSHORE });
    expect(screen.queryByText(FLORIDA_DIVER_DOWN_FLAG_NOTICE)).toBeNull();
  });
});

describe("SiteDiveProfile — depth and certification copy", () => {
  it("renders unknown depth as 'not recorded', never as a level", () => {
    renderProfile({ name: "Unknown Depth Reef", ...LIKELY });

    expect(screen.getByText("Depth not recorded")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Within Open Water training depth/);
    expect(body).not.toMatch(/Within Advanced Open Water training depth/);
    expect(body).toMatch(/That is missing data, not a sign the site is shallow/);
  });

  it("phrases suitability as training depth, never as permission", () => {
    renderProfile({ name: "Copenhagen", ...LIKELY, description: reportedDepth("15-30 ft") });

    expect(screen.getByText("Within Open Water training depth")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/you can dive/i);
    expect(body).not.toMatch(/safe to dive/i);
    expect(body).not.toMatch(/certified to dive/i);
    expect(body).toMatch(/guidance for filtering a map, not permission to dive/);
  });

  it("labels an Advanced Open Water depth at that level", () => {
    renderProfile({ name: "Ledge", ...LIKELY, description: reportedDepth("70-95 ft") });
    expect(screen.getByText("Within Advanced Open Water training depth")).toBeTruthy();
  });

  it("does not call the 100–130 ft band 'beyond recreational limits'", () => {
    // `minimumLevel` is already `deep_specialty` here while
    // `entirelyBeyondRecreational` is still false — printing
    // CERTIFICATION_LABEL verbatim would wrongly say this is past the
    // recreational limit.
    renderProfile({ name: "Deep Ledge", ...LIKELY, description: reportedDepth("110-125 ft") });

    expect(screen.getByText("Deeper than Advanced Open Water training depth")).toBeTruthy();
    expect(screen.getByText(/Still inside the 130 ft recreational limit/)).toBeTruthy();
    expect(screen.queryByText("Technical dive — beyond recreational limits")).toBeNull();
  });

  it("labels a technical-depth site plainly instead of hiding it", () => {
    renderProfile({ name: "RBJ & Chris Corey", ...OFFSHORE, description: reportedDepth("200-270 ft") });

    expect(screen.getByText("Technical dive — beyond recreational limits")).toBeTruthy();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/technical training required/);
    expect(body).toMatch(/Listed here because it is worth knowing about/);
    expect(body).toMatch(/not a dive to work up to on an Open Water or Advanced Open Water certification/);
  });

  it("discloses when a depth was read out of unreviewed imported text", () => {
    renderProfile({ name: "Delray Wreck", ...LIKELY, description: reportedDepth("25 feet") });
    expect(screen.getByText(/Depth read from the imported source text/)).toBeTruthy();
    expect(screen.getByText(/“25 feet”/)).toBeTruthy();
  });

  it("does not add that disclosure when the depth came from a column", () => {
    renderProfile({ name: "Copenhagen", ...LIKELY, depth_min_ft: 15, depth_max_ft: 30 });
    expect(screen.getByText("Within Open Water training depth")).toBeTruthy();
    expect(screen.queryByText(/Depth read from the imported source text/)).toBeNull();
  });
});

describe("SiteDiveProfile — dive difficulty", () => {
  it("renders a difficulty badge with visible risk factors, never a bare verdict", () => {
    renderProfile({ name: "Deep wreck", ...OFFSHORE, depth_min_ft: 105, depth_max_ft: 132 });
    expect(screen.getByText("Advanced")).toBeTruthy();
    // A level with no explanation reads as an opaque verdict, which is
    // exactly what classifyDiveDifficulty's own header says never to render.
    expect(screen.getByText(/deep-specialty depth range/i)).toBeTruthy();
  });

  it("says not-enough-data rather than guessing when nothing is measurable", () => {
    renderProfile({ name: "Mystery site", ...OFFSHORE });
    expect(screen.getByText("Not enough data to assess")).toBeTruthy();
    expect(screen.queryByText("Beginner")).toBeNull();
  });

  it("never phrases the difficulty label as a safety rating", () => {
    renderProfile({ name: "Copenhagen", ...OFFSHORE, depth_min_ft: 15, depth_max_ft: 30 });
    expect(screen.getByText(/not a safety rating/i)).toBeTruthy();
  });
});

describe("SiteDiveProfile — overhead environment callout", () => {
  it("shows a structured cave warning, not just prose buried in the description", () => {
    renderProfile({ name: "Eagle's Nest", ...OFFSHORE, site_type: "cave" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/full cave certification/i);
    expect(alert.textContent).toMatch(/Overhead environment — cave/);
    expect(screen.getByText("Technical")).toBeTruthy();
  });

  it("shows a cavern warning for a spring, headlined distinctly from a full cave warning", () => {
    renderProfile({ name: "Blue Grotto Spring", ...OFFSHORE, site_type: "spring" });
    const alert = screen.getByRole("alert");
    // The cavern warning's own body legitimately explains the cave boundary
    // ("going beyond it is cave diving and requires full cave certification")
    // — the distinguishing signal is the headline, not the absence of the
    // word "cave" anywhere in the copy.
    expect(alert.textContent).toMatch(/Overhead environment — cavern/);
    expect(alert.textContent).not.toMatch(/^Overhead environment — cave\./);
  });

  it("shows no overhead callout at all for an ordinary reef", () => {
    renderProfile({ name: "Copenhagen", ...OFFSHORE, site_type: "shipwreck", depth_min_ft: 15, depth_max_ft: 30 });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("formatShoreDistance", () => {
  it("uses yards below half a mile, rounded to 10", () => {
    expect(formatShoreDistance(0.05)).toBe("90 yd");
    expect(formatShoreDistance(0.17)).toBe("300 yd");
    expect(formatShoreDistance(0.4999)).toBe("880 yd");
  });

  it("uses miles at and above half a mile", () => {
    expect(formatShoreDistance(0.5)).toBe("0.5 mi");
    expect(formatShoreDistance(324.6114)).toBe("324.6 mi");
  });
});
