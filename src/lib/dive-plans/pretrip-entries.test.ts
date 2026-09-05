import { describe, expect, it } from "vitest";
import { upcomingPretripEntries } from "./pretrip-entries";
import type { DivePlanWithSite } from "./queries";

// Fixed "now" injected into every call below (see upcomingPretripEntries's
// own doc comment on why `now` is a parameter, not the real system clock)
// so these assertions never depend on when the test happens to run.
const NOW = new Date(2026, 7, 13); // 2026-08-13
const FUTURE = "2026-08-19";
const PAST = "2026-08-09";

function plan(overrides: Partial<DivePlanWithSite> = {}): DivePlanWithSite {
  return {
    id: "plan-1",
    site: { id: "site-1", name: "Nine Mile Reef", site_type: "artificial_reef" },
    planned_date: FUTURE,
    planned_window: null,
    diving_with: null,
    status: "planned",
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("upcomingPretripEntries", () => {
  it("converts a real future, site-attached plan into a PretripPlanEntry", () => {
    const result = upcomingPretripEntries([plan()], NOW);
    expect(result).toEqual([{ id: "site-1", name: "Nine Mile Reef", diveDate: FUTURE }]);
  });

  it("excludes a past-dated plan — nothing left to prefetch before a dive that already happened", () => {
    const result = upcomingPretripEntries([plan({ planned_date: PAST })], NOW);
    expect(result).toEqual([]);
  });

  it("excludes a plan with no attached site — PrefetchButton needs a real siteId", () => {
    const result = upcomingPretripEntries([plan({ site: null })], NOW);
    expect(result).toEqual([]);
  });

  it("dedupes two plans for the same site, keeping one entry", () => {
    const result = upcomingPretripEntries(
      [plan({ id: "plan-1", planned_date: FUTURE }), plan({ id: "plan-2", planned_date: "2026-08-25" })],
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("site-1");
  });

  it("keeps distinct entries for two different sites", () => {
    const result = upcomingPretripEntries(
      [
        plan({ site: { id: "site-1", name: "Nine Mile Reef", site_type: "artificial_reef" } }),
        plan({ id: "plan-2", site: { id: "site-2", name: "Wreck of the Anna", site_type: "shipwreck" } }),
      ],
      NOW,
    );
    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.id).sort()).toEqual(["site-1", "site-2"]);
  });

  it("returns an empty array for no plans, the honest 'nothing to prefetch' state", () => {
    expect(upcomingPretripEntries([], NOW)).toEqual([]);
  });

  it("mirrors the real query's mixed-batch shape end-to-end (live-verified against the real schema 2026-08-13)", () => {
    // Confirmed live: a real user with a past plan for site A, a future
    // plan for site A, and a future plan for site B correctly produces one
    // entry per site, past excluded.
    const result = upcomingPretripEntries(
      [
        plan({ id: "p1", planned_date: PAST, site: { id: "site-a", name: "Nine Mile Reef", site_type: "artificial_reef" } }),
        plan({ id: "p2", planned_date: FUTURE, site: { id: "site-a", name: "Nine Mile Reef", site_type: "artificial_reef" } }),
        plan({ id: "p3", planned_date: FUTURE, site: { id: "site-b", name: "Wreck of the Anna", site_type: "shipwreck" } }),
      ],
      NOW,
    );
    expect(result).toEqual([
      { id: "site-a", name: "Nine Mile Reef", diveDate: FUTURE },
      { id: "site-b", name: "Wreck of the Anna", diveDate: FUTURE },
    ]);
  });
});
