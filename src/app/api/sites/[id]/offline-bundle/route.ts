import { NextResponse, type NextRequest } from "next/server";
import { getSiteWithHazards } from "@/lib/sites/queries";
import { buildSiteBundle } from "@/lib/offline/site-bundle";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/offline/logger";

/**
 * Signed offline bundle for one site (Task 12): the site row plus its hazard
 * reports, checksummed and HMAC-signed so the browser can verify it before
 * caching (THREAT_MODEL.md §2). Public, like the site data itself.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let id: string;
  try {
    ({ id } = await context.params);
  } catch (error) {
    logger.error("bundle.params_read_failed", { error: errorMessage(error) });
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  // Fail closed before touching the database: an unsigned bundle is never served.
  if (!process.env.BUNDLE_SIGNING_SECRET) {
    logger.error("bundle.signing_secret_missing", { siteId: id });
    return NextResponse.json(
      { error: "Offline saving isn't set up on this server yet.", code: "not_configured" },
      { status: 503 },
    );
  }

  const { site, hazards, truncated, error } = await getSiteWithHazards(id);
  if (error) {
    return NextResponse.json({ error: "Couldn't load this site.", code: "load_failed" }, { status: 502 });
  }
  if (!site) {
    return NextResponse.json({ error: "Site not found.", code: "not_found" }, { status: 404 });
  }

  try {
    const bundle = buildSiteBundle(site, hazards, truncated);
    return NextResponse.json(bundle, { headers: { "Cache-Control": "no-store" } });
  } catch (buildError) {
    logger.error("bundle.build_failed", { siteId: id, error: errorMessage(buildError) });
    return NextResponse.json({ error: "Couldn't build the offline bundle.", code: "build_failed" }, { status: 500 });
  }
}
