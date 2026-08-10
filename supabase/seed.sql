-- seed.sql
-- Starter example data — NOT the real content seed.
--
-- Real site seeding is a founder-curated content task (TASKS.md
-- P0-B.6), not an engineering task, since there's no community of
-- contributors yet to source COMMUNITY-tagged data from. This file
-- exists only so `supabase db reset` / local dev has a few rows to
-- render against the map component (src/components/site-map.tsx),
-- which already uses La Jolla Cove as its placeholder default view.
--
-- All rows here are tagged 'VERIFIED' and have created_by = NULL
-- (nullable by design — see supabase/README.md) since no real
-- auth.users row exists to attribute them to in a fresh project.
--
-- Apply with: supabase db reset  (runs migrations then this file)
-- or paste directly into the Supabase SQL editor after the migrations.

insert into sites (name, description, latitude, longitude, provenance, legal_access_status)
values
  (
    'La Jolla Cove',
    'Popular San Diego shore dive/snorkel site inside the San Diego-Scripps '
    'Coastal Marine Conservation Area. Calm, clear water and abundant '
    'marine life (garibaldi, leopard sharks seasonally). Entry is a '
    'sandy/rocky beach with a short surface swim to the reef.',
    32.8328,
    -117.2713,
    'VERIFIED',
    'marine_protected_area'
  ),
  (
    'Casino Point Dive Park',
    'Dedicated shore dive park on Catalina Island, CA — a protected cove '
    'with permanent moorings, kelp forest, and several sunken attractions '
    'placed for divers. One of the most established shore-accessible dive '
    'parks in Southern California.',
    33.3428,
    -118.3208,
    'VERIFIED',
    'open'
  ),
  (
    'Shaw''s Cove',
    'Laguna Beach, CA shore dive with a sandy entry, rocky reef, and small '
    'cave/swim-through features. A long-standing local favorite for '
    'beginner-to-intermediate shore diving.',
    33.5478,
    -117.7861,
    'VERIFIED',
    'open'
  );
