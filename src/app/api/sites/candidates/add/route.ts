import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { classifyShoreAccess } from "@/lib/sites/shore-access";
import type { ResearchSource, SiteType } from "@/lib/sites/types";
import type { SiteMarker } from "@/lib/sites/types";
import { logger } from "@/lib/site-discovery/logger";

/**
 * Persists one candidate from the map-pan AI-assisted discovery fallback
 * (`plan.md` Resolved Spec Decision #10, 2026-08-11) as a real `sites` row
 * — the founder's explicit, deliberate design: no moderation queue, no
 * waiting on admin approval. "I'm using the app and I want to discover a
 * new location, I should see the results immediately." Same self-service
 * `COMMUNITY`-provenance insert `hazard_reports`/`lds_status` already use
 * (`sites_insert_own`, `0002_rls.sql`) — a diver clicking "Add to map"
 * after reading the citations shown IS the review step, the same way it
 * already is for every other self-service submission in this schema.
 * `legal_access_status` is left `null` ("not yet assessed") — AI web
 * research isn't a citation-grade legal determination.
 *
 * Signed-in only (401 otherwise, matches `research-area`'s gate) — writes
 * through the user's own server client, not the service-role client, so
 * `sites_insert_own`'s RLS check and the existing `sites_rate_limit`
 * trigger (5/10min, `0011_sites_rate_limit.sql`) both apply exactly as
 * they do to any other self-service `sites` insert. No new per-user gate
 * needed here.
 */

interface AddCandidateBody {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  site_type?: unknown;
  depth_min_ft?: unknown;
  depth_max_ft?: unknown;
  research_summary?: unknown;
  research_sources?: unknown;
}

const VALID_SITE_TYPES: readonly SiteType[] = [
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
];

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function parseOptionalDepth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResearchSources(value: unknown): ResearchSource[] | null {
  if (!Array.isArray(value)) return null;
  const sources = value.filter(
    (entry): entry is ResearchSource =>
      !!entry && typeof entry === "object" && typeof entry.title === "string" && typeof entry.url === "string",
  );
  return sources.length > 0 ? sources : null;
}

export async function POST(request: NextRequest) {
  let body: AddCandidateBody;
  try {
    body = (await request.json()) as AddCandidateBody;
  } catch (error) {
    logger.warn("candidates_add.invalid_json_body", { message: errorMessage(error) });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const latitude = parseCoordinate(body.latitude, -90, 90);
  const longitude = parseCoordinate(body.longitude, -180, 180);
  const siteType = VALID_SITE_TYPES.includes(body.site_type as SiteType) ? (body.site_type as SiteType) : null;
  const researchSummary = typeof body.research_summary === "string" ? body.research_summary.trim() : "";
  const researchSources = parseResearchSources(body.research_sources);

  if (!name) {
    return NextResponse.json({ error: "A site name is required." }, { status: 400 });
  }
  // A site with no coordinates can't be placed on the map — this candidate
  // isn't addable directly; the diver would need to research it further
  // before it has a real, citable location.
  if (latitude === null || longitude === null) {
    return NextResponse.json(
      { error: "This candidate has no confirmed coordinates and can't be added directly." },
      { status: 400 },
    );
  }
  if (!siteType) {
    return NextResponse.json({ error: "A valid site_type is required." }, { status: 400 });
  }
  if (!researchSummary || !researchSources) {
    return NextResponse.json(
      { error: "A research summary and at least one source are required." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in required to add a site." }, { status: 401 });
  }

  const depthMinFt = parseOptionalDepth(body.depth_min_ft);
  const depthMaxFt = parseOptionalDepth(body.depth_max_ft);

  // Same classification the live import pipeline (osm-import.ts) and the
  // manual research-backed inserts done earlier this session both use —
  // no OSM tag available for a web-research candidate, so this is a
  // curated-tier-only classification.
  const shoreAccess = classifyShoreAccess({ latitude, longitude });

  try {
    const { data, error } = await supabase
      .from("sites")
      .insert({
        name,
        description: null,
        latitude,
        longitude,
        provenance: "COMMUNITY",
        legal_access_status: null,
        site_type: siteType,
        depth_min_ft: depthMinFt,
        depth_max_ft: depthMaxFt,
        shore_access: shoreAccess.confidence,
        shore_access_method: shoreAccess.method,
        shore_entry_id: shoreAccess.nearestEntry?.id ?? null,
        shore_distance_yards: shoreAccess.distanceMiles != null ? shoreAccess.distanceMiles * 1760 : null,
        research_summary: researchSummary,
        research_sources: researchSources,
        research_summary_updated_at: new Date().toISOString(),
        created_by: user.id,
      })
      .select(
        "id, name, latitude, longitude, provenance, legal_access_status, site_type, depth_min_ft, depth_max_ft, shore_access, shore_access_method",
      )
      .single();

    if (error) throw error;

    const marker: SiteMarker = {
      id: data.id,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      provenance: data.provenance,
      legal_access_status: data.legal_access_status,
      site_type: data.site_type,
      depth_min_ft: data.depth_min_ft,
      depth_max_ft: data.depth_max_ft,
      shore_access: data.shore_access,
      shore_access_method: data.shore_access_method,
      hasHazardReport: false,
    };

    logger.info("candidates_add.inserted", { userId: user.id, siteId: data.id, name });
    return NextResponse.json({ site: marker }, { status: 201 });
  } catch (error) {
    logger.error("candidates_add.insert_failed", { userId: user.id, name, message: errorMessage(error) });
    return NextResponse.json({ error: "Couldn't add this site — try again." }, { status: 500 });
  }
}
