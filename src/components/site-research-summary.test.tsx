// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SiteResearchSummary, siteResearchFreshnessLabel } from "./site-research-summary";

/**
 * Coverage for Task 22's researched-summary section. The property that
 * matters most here isn't the happy path — it's that a site with no research
 * yet (the overwhelming majority of the catalogue in v1 scope) renders
 * nothing, and that a researched summary never appears without its
 * "not independently verified" disclosure.
 */

afterEach(cleanup);

describe("SiteResearchSummary", () => {
  it("renders nothing when the site has not been researched yet", () => {
    const { container } = render(<SiteResearchSummary summary={null} sources={null} updatedAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the summary alongside an explicit non-verification disclosure", () => {
    render(
      <SiteResearchSummary
        summary="A popular, well-documented shore dive entered just north of the pier."
        sources={null}
        updatedAt={null}
      />,
    );

    expect(screen.getByText(/popular, well-documented shore dive/)).toBeTruthy();
    expect(screen.getByText(/not independently verified/)).toBeTruthy();
  });

  it("renders each source as a real, named link, not a generic label", () => {
    render(
      <SiteResearchSummary
        summary="Some summary."
        sources={[
          { title: "Force-E Scuba Centers", url: "https://www.force-e.com/example" },
          { title: "Project Baseline Gulfstream", url: "https://www.projectbaselinegulfstream.com/example" },
        ]}
        updatedAt={null}
      />,
    );

    const forceE = screen.getByText("Force-E Scuba Centers") as HTMLAnchorElement;
    expect(forceE.tagName).toBe("A");
    expect(forceE.getAttribute("href")).toBe("https://www.force-e.com/example");
    expect(forceE.getAttribute("target")).toBe("_blank");
    expect(forceE.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Project Baseline Gulfstream")).toBeTruthy();
  });

  it("omits the sources list entirely when there are none, rather than showing an empty heading", () => {
    render(<SiteResearchSummary summary="Some summary." sources={null} updatedAt={null} />);
    expect(screen.queryByText("Sources")).toBeNull();
  });

  it("shows a freshness label when a valid timestamp is present", () => {
    render(<SiteResearchSummary summary="Some summary." sources={null} updatedAt="2026-08-10T12:00:00.000Z" />);
    expect(screen.getByText(/^Per research as of/)).toBeTruthy();
  });

  it("omits the freshness label for a missing or invalid timestamp, rather than showing a broken date", () => {
    const { rerender } = render(<SiteResearchSummary summary="Some summary." sources={null} updatedAt={null} />);
    expect(screen.queryByText(/Per research as of/)).toBeNull();

    rerender(<SiteResearchSummary summary="Some summary." sources={null} updatedAt="not-a-real-date" />);
    expect(screen.queryByText(/Per research as of/)).toBeNull();
  });
});

describe("siteResearchFreshnessLabel", () => {
  it("formats a valid timestamp as a long date, not a raw ISO string", () => {
    const label = siteResearchFreshnessLabel("2026-08-10T12:00:00.000Z");
    expect(label).toMatch(/^Per research as of /);
    expect(label).not.toContain("T12:00:00");
  });

  it("returns null for a missing or invalid timestamp", () => {
    expect(siteResearchFreshnessLabel(null)).toBeNull();
    expect(siteResearchFreshnessLabel("not-a-real-date")).toBeNull();
  });
});
