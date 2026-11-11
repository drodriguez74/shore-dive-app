import type { HazardReport, Site } from "@/lib/sites/types";

/** Shared fixtures for the offline-bundle tests. */

export const FIXTURE_SITE: Site = {
  id: "site-123",
  name: "Blue Heron Bridge",
  description: "Shore dive under the bridge.",
  latitude: 26.7834,
  longitude: -80.0417,
  provenance: "COMMUNITY",
  legal_access_status: "open",
  site_type: "shore_reef",
  depth_min_ft: 6,
  depth_max_ft: 20,
  created_by: "user-1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

export const FIXTURE_HAZARDS: HazardReport[] = [
  {
    id: "hazard-1",
    site_id: "site-123",
    provenance: "COMMUNITY",
    description: "Strong current at the east span on the outgoing tide.",
    reported_by: "user-2",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  },
];
