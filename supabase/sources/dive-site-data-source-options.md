# External/licensed dive-site data source options — research report (no action taken)

Researched 2026-08-08, founder-directed, in response to the "why does the map default to California" question surfacing that `sites` has no external data feed and no way for anyone to add a row through the app (see `TASKS.md` `T11.5.9`). **Nothing here has been wired in.** This is a landscape survey to inform a founder decision, not a recommendation to implement — see CLAUDE.md's "no paid dependency without checking the funding model" standard and the project's no-budget constraint.

## 1. OpenStreetMap (via Overpass API)

Crowdsourced open geodata. Real tagging scheme exists: `sport=scuba_diving` (paired with a physical feature tag like `natural=reef`, `historic=wreck`, `natural=cave_entrance`), plus a proposed-but-real-world-used `scuba_diving:entry=shore|boat|pier` sub-tag, `scuba_diving:depth`, `scuba_diving:hazard`. Overpass API (overpass-api.de, free, public instance) is queryable today — a live query for Florida (`area["name"="Florida"]; node["sport"="scuba_diving"](area.a);`) returned **34 real results**: 13 shipwrecks, 16 freshwater springs, and a handful of genuine shore-entry sites (Sebastian Inlet, Fort Pickens Jetties, Devil's Den).

**Spot-check finding:** a tight-radius query around Phil Foster Park / Blue Heron Bridge — arguably the most famous shore dive site in South Florida — returned **zero results**. Coverage is real but patchy; well-known sites are missing entirely, so this can't be a sole source without a community-contribution loop to fill gaps.

**License:** ODbL. Requires visible attribution ("© OpenStreetMap contributors" + link to the license) on any produced work. If a derivative *database* (not just a rendered map) is built and publicly conveyed from OSM data, that derivative database must itself be shared under ODbL (share-alike) — this matters for how the app's internal `sites` table would need to be licensed if OSM-derived rows are stored and redistributed, not just displayed. The public Overpass instance also has a documented fair-use/rate-limit policy — fine for occasional syncs, not meant for high-frequency production load without self-hosting.

**Verdict:** Free, real but incomplete shore-dive coverage in FL, ODbL attribution + possible share-alike obligation — most promising single option, still needs founder review on the share-alike implication and a plan to backfill gaps (e.g. Blue Heron Bridge) via `COMMUNITY`-tier submissions.

## 2. PADI / Scuba Earth

No public API or licensable dataset found. ScubaEarth is reportedly being migrated/retired in favor of "MyPadi." No scraping-permissive ToS found — PADI Travel's general terms didn't surface anything scraping-friendly, and current ToS language could not be verified either way (not confirmed, not assumed safe). Several *third-party* aggregators (thedivesapi.com / "Divesites API" on RapidAPI, "World Scuba Diving Sites API" on Zyla API Hub) claim PADI-adjacent site/operator data, but none published clear pricing or redistribution terms on their public pages — would require signing up to see actual free-tier limits and ToS.

**Verdict:** No public PADI API/dataset found; third-party aggregators exist but their cost/license terms are unverified from public pages — not viable to recommend without further digging, and likely paid at meaningful volume.

## 3. NOAA

Real and strong for the *legal/hazard* side, not the core site list. NOAA Office of Coast Survey nautical chart data is explicitly dedicated to the public domain via CC0-1.0. The National Marine Protected Areas Center's MPA Inventory is a maintained, comprehensive geospatial database of US MPAs (shapefile/KML, web mapping service), aligned with federal open-data policy requiring no-restriction reuse. Well-maintained, federally funded, actively updated.

**Verdict:** Free, CC0/public-domain, well-maintained — strong fit for `legal_access_status` (MPA boundaries, closures) even though it doesn't give a shore-dive-site list itself.

## 4. Florida FWC Artificial Reef Program

Real and substantial: **4,442+ reef deployment records** across 34 of 35 coastal counties, with material type, depth, and county fields, current through May 2025 (actively maintained). Accessible via FWC's ArcGIS REST service (`gis.myfwc.com/.../Artificial_Reef_Locations_in_Florida`). However: the service metadata carries an explicit copyright notice ("FWC Division of Marine Fisheries Management") and no CC0/open-license statement was found in the accessible schema — several FWC/ArcGIS Hub "about" pages 404'd during research, so the license shown in their Hub UI could not be confirmed either way. Florida public-records law plausibly supports reuse, but that's a legal inference, not a confirmed ToS grant. Also: most artificial reefs are boat/offshore dives, not shore-entry — relevance to a shore-dive app is narrower than it first appears; would need filtering by depth/distance-from-shore to find the nearshore subset.

**Verdict:** Real, actively maintained, mostly-not-shore-specific dataset with an unconfirmed license — promising for the hazard/logistics layer, needs explicit license confirmation before redisplay, not a core shore-sites feed as-is.

## 5. Other options found

- **`github.com/jbunderwater/dive-vibe-community`** (referenced in a ScubaBoard thread): 2,800+ sites, "licensed for community use" (not a recognized license string — ambiguous). Built by scraping OSM via Overpass and using AI agents to cross-reference ScubaBoard threads and other databases; the author's own community acknowledges AI-hallucinated inaccuracies needing local-diver correction. This is itself a derivative of OSM (inheriting ODbL questions) layered with unverified AI inference — at best a `COMMUNITY`-tier seed, never `VERIFIED`, and arguably exactly the kind of unmoderated AI-inferred data the project's `MODEL_INFERRED` tagging convention exists for.
- **Zentacle** — a real, actively used dive-site review app/website (20k+ users, crowdsourced global site database, shore/snorkel spots included). No public API or license terms found; would require directly contacting them (support@zentacle.com).
- **DiveBuddy** — not substantively found; treat as unverified/likely defunct or too small to matter.

**Verdict (this group):** Interesting but none is a clean, verified, freely-redistributable source — each needs direct outreach or deeper ToS digging before it's usable.

## Recommendation (not an authorization to implement)

Ranked for a founder decision: **OpenStreetMap/Overpass is the most realistic starting point** — genuinely free, has a real tagging convention for exactly this use case, live-confirmed data for Florida — but its coverage has real, material gaps (missing Blue Heron Bridge is disqualifying on its own for a "shore dive" app) and its ODbL share-alike clause needs a real legal read before any OSM-derived rows get stored in the app's own database, not just displayed on a map. **NOAA data is the safest, cleanest win** for the hazard/access-status layer specifically (unambiguous CC0, well-maintained) and is worth adopting regardless of what happens with the core site list. **FWC's artificial reef data** is compelling in scale and currency but its license is genuinely unconfirmed, and much of it may be boat-only rather than shore-entry — worth a direct records request or a look at the ArcGIS Hub license badge in a real browser before relying on it. **PADI/ScubaEarth is not viable** — no public API, no confirmed scraping rights. Everything in "Other" is either unverified licensing or requires manual outreach.

**None of these should be wired in without the founder explicitly signing off** on the ODbL/attribution and share-alike question and confirming FWC's actual license — both are load-bearing for whether third-party data can even be *stored* (not just displayed) under the app's `VERIFIED`/`COMMUNITY` model.
