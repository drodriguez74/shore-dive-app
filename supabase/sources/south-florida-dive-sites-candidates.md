# South Florida shore dive site candidates — research report (not yet inserted)

Researched 2026-08-08, founder-directed, in response to the "why does the map default to California" question surfacing that the app has no Florida site content and no way for anyone to add a site through the app at all (see `TASKS.md` `T11.5.9`). **Nothing in this file has been inserted into the `sites` table.** Same standard as `webcam-sources.md`: every row was independently checked via web search/fetch before being reported; nothing here should be inserted as `VERIFIED` without the founder's own confirmation, and several rows need precise geocoding before insertion (flagged per-row below).

## Summary table

| Name | County | Approx. Lat/Long (source) | Legal access status (confidence) |
|---|---|---|---|
| Blue Heron Bridge (Phil Foster Park) | Palm Beach | 26.7842, -80.0429 (address-anchored search synthesis, not independently re-verified against a primary GPS field — **treat as approximate**) | `open` — high confidence |
| Erojacks Reef, Dr. Von D. Mizell-Eula Johnson SP (f/k/a John U. Lloyd Beach SP) | Broward | 26.0756, -80.1113 (zentacle.com dive-site DB, park-level, not reef-specific) | `open` — moderate-high confidence |
| Turtle Reef, Deerfield Beach Intl Fishing Pier | Broward | 26.3165, -80.0742 (pier address geocode) | `open` — moderate confidence |
| El Prado Park shore dive | Broward | Not independently geocoded — address only: 4500 El Mar Dr, Lauderdale-By-The-Sea FL 33308 | `open` — high confidence |
| Datura Avenue Portal | Broward | Not independently geocoded — address only: ~4300 El Mar Dr / Datura Ave, 33308 | `open` — high confidence |
| Red Reef Park | Palm Beach | 26.3663, -80.0704 (borrowed from adjacent Gumbo Limbo Nature Center "across the street" — **approximate, not the park's own coordinate**) | `open` — moderate-high confidence |
| Hollywood North Beach Park (Guardians of the Reef, McClellan/Simms St. sites) | Broward | Not independently geocoded — address only: 3601 N Ocean Dr, Hollywood FL 33019 | `open` — moderate confidence |

**Where "Not independently geocoded" appears**, the address was confirmed from multiple sources but no source page yielded a precise decimal lat/long — no digits were fabricated. Geocode the address directly (e.g. via Mapbox's own geocoder, already a project dependency) before writing a `sites` row.

## Per-site notes

**Blue Heron Bridge (Phil Foster Park), Riviera Beach** — Shore/wade entry off the Intracoastal at Phil Foster Park, Blue Heron Blvd. Internationally known macro/critter site (seahorses, frogfish, octopus, nudibranchs); max depth ~20 ft, best dived at high slack tide due to strong current otherwise. Address (900 Blue Heron Blvd, 33404) confirmed via Palm Beach County's own park page. County page also confirms it's a public county park, sunrise-to-sunset beach access, no permit for ordinary shore diving/snorkeling (a permit is required only for commercial dive-instruction businesses and for boat-trailer parking, both separate from general public water access) — hence `open` at high confidence. Sources: discover.pbc.gov/parks/Locations/Phil-Foster.aspx, puravidadivers.com/dive-blue-heron-bridge-phil-foster-park, force-e.com/go-diving/shore-dive-sites/blue-heron-bridge-at-phil-foster-park.

**Erojacks Reef, Dr. Von D. Mizell-Eula Johnson State Park (Dania Beach)** — Formerly John U. Lloyd Beach State Park, renamed by the state; barrier-island park with a natural limestone reef and the "Erojacks" (WWII-era dolos erosion-control structures, now a reef) roughly 1,800 ft north of Dania Beach Pier, ~300 ft offshore. Florida state park, standard $6/vehicle day-use fee, no fee-exempt/restricted designation found in official park material. No documentation found that the reef itself carries a special MPA designation (the park's manatee sanctuary, Whiskey Creek, is a separate inland waterway, not the dive area) — `open` at moderate-high rather than high confidence because a special designation couldn't be positively ruled out, only not found. Sources: floridastateparks.org/mizell, zentacle.com (John_U_Lloyd_Beach_Park), cudamanadventures.com/2014/06/15/john-u-lloyd-beach-state-park-june-2014.

**Turtle Reef, Deerfield Beach International Fishing Pier** — Entry a little north of the pier ("Turtle Beach"); rocky artificial reef ~150 ft offshore, 6–12 ft depth, named for turtles seen April–August. Heavy boat traffic — SMB required, and diving is prohibited within some distance of the pier itself (standard FL statute, not park-specific). No permit found for general beach/shore access beyond normal city beach rules. Sources: southfloridadiving.com/deerfield-beach, snorkeling.floridaoutdooradventures.info/broward-county/snorkeling-turtle-reef-deerfield-beach.

**El Prado Park, Lauderdale-by-the-Sea** — Town beach park (4500 El Mar Dr), showers/benches/ADA mat, first reef ~100 yd swim offshore, 8–20 ft depth. Confirmed as a named public "beach portal" on the town's own parks page; only cost is metered street parking, no water-access permit. Sources: lauderdalebythesea-fl.gov/169/Parks-Beach-Portals, force-e.com/go-diving/shore-dive-sites/lauderdale-by-the-sea-shore-dive.

**Datura Avenue Portal, Lauderdale-by-the-Sea** — Distinct entry point south of Commercial Blvd from El Prado, with a tank-rack bench; leads to a replica "shipwreck trail" and a second reef at 12–15 ft. Same town, same open-access status as El Prado. Caveat worth including in the description: diving is prohibited within 300 ft of Anglin's Pier at the end of Commercial Blvd — moot right now since the pier has been closed since Hurricane Irma (2017) with a 2026 rebuild only recently announced, but worth noting if the pier reopens. Sources: force-e.com/go-diving/shore-dive-sites/lauderdale-by-the-sea-shore-dive, southfloridadiving.com/dive-sites/reef-dive-site/anglin-pier-reef.

**Red Reef Park, Boca Raton** — City oceanfront park (1400 N Ocean Blvd) with a maintained snorkel trail: a jetty plus 20 placed artificial reef modules just offshore, beginner-friendly. `open` for pedestrian/beach access, but note for the description: non-resident vehicles pay a beach-parking fee (city page mentions "2024–2025 Beach Permits," other sources cite $35–50/day for non-permit holders) — this is a parking fee, not a legal-access restriction, same pattern as Casino Point in the existing seed data, so `open` still fits, just disclose the fee. Sources: myboca.us/facilities/facility/details/redreefpark-49, Wikipedia (Gumbo Limbo Environmental Complex, coordinate source).

**Hollywood North Beach Park (Guardians of the Reef), Hollywood** — City-run nearshore artificial reef project (part of the "1000 Mermaids" initiative), two named sub-sites at McClellan St. and Simms St., 8–15 ft depth, art + habitat modules, marked by buoys. Shallow and better documented as a snorkel site than a scuba site — include with that caveat in the description. Public city park, no permit mentioned for beach/water access. Sources: hollywoodfl.org/1195/Offshore-Reef-Guide, broward.us (2025-05-28 coverage).

## Checked and deliberately excluded

- **Anne's Beach (Islamorada)** — real and shore-accessible, but it's on Lower Matecumbe Key, **Monroe County** (the Florida Keys), not Miami-Dade/Broward/Palm Beach. Out of the requested geographic scope; not included above.
- **Hugh Taylor Birch State Park** — real park, real beach access, but every source found describes beach-adjacent **snorkeling**, not a documented scuba shore-dive site; no reef/depth/entry details comparable to the others. Recommend `legal_access_status: null` and holding it out of the initial batch until better dive-specific sourcing turns up, rather than asserting it's a dive site on weak evidence.
- **"Alligator Reef" near Pompano Beach** — could not confirm this as a real Broward shore-access point; likely a conflation with Alligator Reef Light off Islamorada (Keys, boat-only). Not included.

## Status

Pending founder review — see `TASKS.md` `T11.5.9`. Once approved, insertion should follow the same traceability pattern as `webcam-sources.md` (service-role key, `reviewed_by`/`reviewed_at` stamped to the founder's real profile id) and should also flag whether these count as `VERIFIED` (founder-reviewed) or `COMMUNITY` (sourced from secondary web research, not first-hand verification) — this batch leans toward `COMMUNITY` given none of it was first-hand-verified by the founder or an established local dive operator directly confirming current conditions.
