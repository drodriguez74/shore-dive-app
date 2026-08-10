# creative/

UX/visual design work for Shore Dive — flow diagrams, high-fidelity mockups, and the design system they're built against. This is the creative counterpart to `TASKS.md`'s engineering tracker; see `CREATIVE_BACKLOG.md` for status.

**Start here:** `design-system/DESIGN_SYSTEM.md` — palette, type, spacing, iconography, motion, and voice/tone. Every mockup in this directory is designed against it. Read it before designing or reviewing anything else here.

## Structure

- `design-system/` — the foundation. `DESIGN_SYSTEM.md` (rationale + rules) and `tokens.css` (drop-in CSS custom properties, not yet wired into the real app).
- `flows/` — one Markdown file per UX flow: a Mermaid state/flow diagram plus the reasoning behind key decisions (edge cases, offline states, permission-denied paths, honest-disclosure copy).
- `mockups/` — one subdirectory per flow, containing self-contained HTML mockups of each key screen/state. Built against real component structure and data models in `src/`, not fantasy screens disconnected from what's actually buildable.
- `CREATIVE_BACKLOG.md` — status tracker.

## Relationship to the real app

Nothing here is wired into `src/` automatically. These are design artifacts for review — think of them as the thing you'd approve before an engineer implements it, not a replacement for implementation. Where a mockup's direction is approved, the actual Tailwind classes/components it implies should be built the normal way, following `CLAUDE.md`'s engineering standards (batch discipline, one flow's implementation = one reviewable change).

## No Figma integration

There's no Figma access in this workflow. The closest equivalents, used throughout this directory:

- **Mermaid diagrams** for flows/states (rendered natively wherever Markdown/Artifacts support Mermaid).
- **Self-contained HTML mockups** for high-fidelity screens — more useful than static Figma frames anyway, since they're real, interactive, and viewable immediately.
- **Claude's own Design System** (`claude.ai/design`) as the actual Figma-equivalent for turning approved mockups into a real, synced component library — via the `/design-sync` skill, which is restricted to explicit user invocation and isn't run automatically as part of this workflow. Mockup files in `mockups/` are structured to be sync-ready (see each flow's mockup directory) so `/design-sync` can pick them up cleanly when you're ready to run it.
