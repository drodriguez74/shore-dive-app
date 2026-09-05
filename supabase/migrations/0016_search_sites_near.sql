-- 0016_search_sites_near.sql
-- Nearest-N site search (plan.md item 24 / TASKS.md T24).
--
-- The search-nearby route read sites with a bounding box, `ORDER BY name`,
-- `LIMIT 200`, then did the radius filter + distance sort in JS. In a dense
-- area (South Florida) the box holds far more than 200 sites, so the 200
-- returned were an alphabetical slice — a diver could miss the wreck 100
-- yards offshore because its name sorts past the 200th row.
--
-- This function does the radius cut and distance order in SQL, so the
-- <=200 rows are always the nearest 200 within the radius. Distance is the
-- same haversine as src/lib/sites/distance.ts (EARTH_RADIUS_MILES = 3958.8)
-- — the two must agree, the client still recomputes per-site distance.
-- A latitude-band prefilter narrows the scan; the exact haversine decides
-- membership. Scale-up path past ~50k rows is PostGIS + a GiST index.

create or replace function public.search_sites_near(
  center_lat double precision,
  center_lng double precision,
  radius_miles double precision,
  max_rows integer default 200
)
returns table (
  id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  provenance provenance_state,
  legal_access_status legal_access_status,
  site_type site_type,
  depth_min_ft double precision,
  depth_max_ft double precision,
  shore_access shore_access_confidence,
  shore_access_method shore_access_method,
  distance_miles double precision
)
language sql
stable
-- SECURITY INVOKER (default): reads `sites` with the caller's privileges,
-- so its public-read RLS (0002_rls.sql) still applies — anon + authenticated.
as $$
  with params as (
    select
      center_lat as lat,
      center_lng as lng,
      greatest(radius_miles, 0) as radius,
      least(greatest(coalesce(max_rows, 200), 1), 1000) as lim,
      -- ~69 mi/degree latitude, rounded down + 1 degree slack, so the band
      -- is wider than needed; the haversine filter below is authoritative.
      (greatest(radius_miles, 0) / 69.0) + 1.0 as lat_pad
  )
  select
    s.id,
    s.name,
    s.latitude::double precision,
    s.longitude::double precision,
    s.provenance,
    s.legal_access_status,
    s.site_type,
    s.depth_min_ft::double precision,
    s.depth_max_ft::double precision,
    s.shore_access,
    s.shore_access_method,
    d.distance_miles
  from sites s
  cross join params p
  cross join lateral (
    select 2 * 3958.8 * asin(sqrt(
      power(sin(radians(s.latitude - p.lat) / 2), 2)
      + cos(radians(p.lat)) * cos(radians(s.latitude))
        * power(sin(radians(s.longitude - p.lng) / 2), 2)
    )) as distance_miles
  ) d
  where s.latitude between p.lat - p.lat_pad and p.lat + p.lat_pad
    and d.distance_miles <= p.radius
  order by d.distance_miles asc
  limit (select lim from params);
$$;

comment on function public.search_sites_near(double precision, double precision, double precision, integer) is
  'Nearest-N dive-site search (plan.md item 24). Sites within radius_miles '
  'of (center_lat, center_lng), ordered by great-circle distance, capped at '
  'max_rows (clamped 1..1000). Distance formula matches src/lib/sites/distance.ts.';

grant execute on function public.search_sites_near(double precision, double precision, double precision, integer)
  to anon, authenticated;
