# Shore Dive

A free, installable web app (Next.js PWA) for discovering and safely diving shore-accessible dive sites: a map of sites with provenance and hazard reports, dive plans, offline saving, a local Safe-Return timer, and post-dive logging.

Live: https://shore-dive-app.vercel.app

## Run it

```bash
cp .env.local.example .env.local   # then fill in the values it describes
npm install
npm run dev                        # http://localhost:3000
```

Checks: `npm run lint`, `npm test`, `npx tsc --noEmit`, `npm run build`.

Database migrations live in `supabase/migrations/` and are applied by hand — see `supabase/README.md`.

## Where things are documented

- `HANDOFF.md` — current state and what to work on next (read first)
- `TASKS.md` — granular progress tracker
- `plan.md` — product spec and the decisions behind it
- `THREAT_MODEL.md` — safety and abuse analysis; read before touching the features it covers
- `CLAUDE.md` / `AGENTS.md` — guidance for AI coding agents
