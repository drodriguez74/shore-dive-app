// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SiteDiscoveryCandidates } from "./site-discovery-candidates";
import type { CandidateSite } from "@/lib/site-discovery/area-research";
import type { SiteMarker } from "@/lib/sites/types";

function candidate(overrides: Partial<CandidateSite> = {}): CandidateSite {
  return {
    name: "Blue Heron Bridge",
    latitude: null,
    longitude: null,
    site_type: "shore_reef",
    depth_min_ft: null,
    depth_max_ft: 20,
    shore_access_claim: "shore-accessible",
    research_summary: "A well-documented shore dive.",
    research_sources: [{ title: "A dive guide", url: "https://example.com/bhb" }],
    ...overrides,
  };
}

const marker: SiteMarker = {
  id: "site-1",
  name: "Blue Heron Bridge",
  latitude: 26.78,
  longitude: -80.04,
  provenance: "COMMUNITY",
  legal_access_status: null,
  site_type: "shore_reef",
  depth_min_ft: null,
  depth_max_ft: 20,
  shore_access: "likely",
  shore_access_method: "curated_entry",
  hasHazardReport: false,
};

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ site: marker }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setInput(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(cleanup);

describe("SiteDiscoveryCandidates — no-coordinates candidate", () => {
  it("disables the top Add button but offers a Google Maps lookup link", () => {
    render(<SiteDiscoveryCandidates candidates={[candidate()]} onAdded={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Add to map" }) as HTMLButtonElement).disabled).toBe(true);

    const link = screen.getByRole("link", { name: /Look up .* on Google Maps/ });
    expect(link.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Blue%20Heron%20Bridge",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("reveals lat/long inputs and keeps the add button disabled until they are valid", () => {
    render(<SiteDiscoveryCandidates candidates={[candidate()]} onAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    const add = () => screen.getByRole("button", { name: "Add with these coordinates" }) as HTMLButtonElement;
    expect(add().disabled).toBe(true);

    setInput("Latitude", "999");
    setInput("Longitude", "-80.04");
    expect(add().disabled).toBe(true); // latitude out of range

    setInput("Latitude", "26.78");
    expect(add().disabled).toBe(false);
  });

  it("submits the manually-entered coordinates to the add route and reports the new site", async () => {
    const fetchMock = mockFetchOk();
    const onAdded = vi.fn();
    render(<SiteDiscoveryCandidates candidates={[candidate()]} onAdded={onAdded} />);

    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    setInput("Latitude", "26.78");
    setInput("Longitude", "-80.04");
    fireEvent.click(screen.getByRole("button", { name: "Add with these coordinates" }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(marker));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ name: "Blue Heron Bridge", latitude: 26.78, longitude: -80.04 });
    expect(screen.queryByRole("button", { name: "Add with these coordinates" })).toBeNull();
  });
});

describe("SiteDiscoveryCandidates — candidate with coordinates", () => {
  it("adds directly with the pipeline coordinates and shows no manual-entry affordance", async () => {
    const fetchMock = mockFetchOk();
    render(
      <SiteDiscoveryCandidates candidates={[candidate({ latitude: 26.78, longitude: -80.04 })]} onAdded={vi.fn()} />,
    );

    expect(screen.queryByRole("link", { name: /Google Maps/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add to map" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Added ✓" })).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ latitude: 26.78, longitude: -80.04 });
  });

  it("surfaces a route validation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "bad coordinates" }) }),
    );
    render(<SiteDiscoveryCandidates candidates={[candidate({ latitude: 1, longitude: 2 })]} onAdded={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to map" }));

    await waitFor(() => expect(screen.getByText("bad coordinates")).toBeTruthy());
  });
});
