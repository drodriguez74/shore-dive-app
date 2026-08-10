// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isOpenStreetMapSourced, SiteSources } from "./site-sources";

/**
 * Provenance/attribution copy tests (T21.22). Two of these assertions are
 * about obligations rather than presentation: ODbL attribution for
 * OSM-imported rows is a licence requirement (plan.md Resolved Decision #6),
 * and `COMMUNITY` meaning "unreviewed" is the honest-disclosure rule from
 * CLAUDE.md applied to the page a diver reads before getting in the water.
 */

const OSM_DESCRIPTION =
  "The old shipwreck known as the Delray Wreck rests at the bottom of the ocean.\n\n" +
  "Automatically imported from OpenStreetMap community map data (© OpenStreetMap contributors, licensed " +
  "ODbL). This entry has not been reviewed by a human — details may be incomplete or inaccurate.";

afterEach(cleanup);

describe("isOpenStreetMapSourced", () => {
  it("detects the attribution sentence osm-import.ts writes", () => {
    expect(isOpenStreetMapSourced(OSM_DESCRIPTION)).toBe(true);
  });

  it("is false for a hand-written description, null, or a non-string", () => {
    expect(isOpenStreetMapSourced("Founder-verified shore entry off Datura Ave.")).toBe(false);
    expect(isOpenStreetMapSourced(null)).toBe(false);
    expect(isOpenStreetMapSourced(undefined)).toBe(false);
    expect(isOpenStreetMapSourced(42 as unknown as string)).toBe(false);
  });
});

describe("SiteSources", () => {
  it("says plainly that COMMUNITY means unreviewed", () => {
    render(<SiteSources provenance="COMMUNITY" description={null} latitude={26.1} longitude={-80.1} />);

    expect(screen.getByText(/not independently reviewed/)).toBeTruthy();
    expect(screen.getByText(/Nobody has checked this entry against the water/)).toBeTruthy();
    expect(screen.getByText(/a lead to verify rather than a fact/)).toBeTruthy();
  });

  it("does not let VERIFIED imply current conditions are verified", () => {
    render(<SiteSources provenance="VERIFIED" description={null} latitude={26.1} longitude={-80.1} />);
    expect(screen.getByText(/That covers the record — not today's conditions in the water/)).toBeTruthy();
  });

  it("renders ODbL attribution with links for an OSM-imported site", () => {
    render(
      <SiteSources provenance="COMMUNITY" description={OSM_DESCRIPTION} latitude={26.1} longitude={-80.1} />,
    );

    const osmLink = screen.getByRole("link", { name: /OpenStreetMap contributors/ });
    expect(osmLink.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    const odblLink = screen.getByRole("link", { name: /Open Database License \(ODbL\)/ });
    expect(odblLink.getAttribute("href")).toBe("https://opendatacommons.org/licenses/odbl/");
    // External links opened in a new tab must not leak the opener.
    for (const link of [osmLink, odblLink]) {
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("omits the OSM attribution block for a non-imported site", () => {
    render(
      <SiteSources
        provenance="VERIFIED"
        description="Founder-verified shore entry."
        latitude={26.1}
        longitude={-80.1}
      />,
    );
    expect(screen.queryByRole("link", { name: /OpenStreetMap contributors/ })).toBeNull();
  });

  it("separates this app's derived guidance from the source's own claims", () => {
    render(<SiteSources provenance="COMMUNITY" description={null} latitude={26.1} longitude={-80.1} />);
    expect(
      screen.getByText(/our derivation, not a claim made by the original source/),
    ).toBeTruthy();
  });

  it("states that coordinates are exact, matching the no-geofuzzing product decision", () => {
    render(<SiteSources provenance="VERIFIED" description={null} latitude={26.18670} longitude={-80.09498} />);
    expect(screen.getByText(/not blurred: 26\.18670, -80\.09498/)).toBeTruthy();
  });
});
