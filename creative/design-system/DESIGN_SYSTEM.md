# Shore Dive — Design System Foundation

Source of truth for look, feel, and UX tone across every flow in `creative/`. Read this before designing any screen. It exists to keep parallel design work (multiple flows, possibly multiple agents, built at different times) from drifting into inconsistent palettes, type, or voice.

This is a **refinement of what's already shipped**, not a replacement. `src/components/` already uses an informal but consistent Tailwind palette (`sky` for primary actions, `zinc` for neutrals/text, `amber` for warnings, `emerald` for success, `violet` for the `COMMUNITY` provenance tag). That palette stays — this document names it, extends it, and adds the one thing that was missing: a distinct brand identity layered on top of purely-functional Tailwind defaults.

## 1. Where the identity comes from

Two pieces of real brand material already exist in the repo, unused by any actual UI:

- **`dive.png`** — a diving-mask icon with a genuine gradient: sampled directly from the file, it runs **blue `#3B73F2` → violet `#8365BE` → pink `#DC577F`**. Not invented for this exercise — pulled from the actual pixels.
- **`src/app/manifest.ts`** — `background_color`/`theme_color` already committed to a dark navy, `#0B1220`. The installed-PWA chrome (splash screen, status bar) is already dark by decision, not by default.

Read together, these point at a coherent direction: **ocean depth at night, lit by a dive-computer glow.** Dark navy as the base — not gloomy, but the specific dark-blue-black of water past the point sunlight reaches — with the blue→violet→pink gradient used the way a dive light or a bioluminescent creature would actually read against that dark: a controlled, glowing accent, not a wash over everything.

This also happens to be the right *functional* choice, not just an aesthetic one: this app is used outdoors, at the water's edge, often in bright sunlight (where a dark, high-contrast UI is more legible than a washed-out light one) and on battery (dark pixels cost less on OLED). Follow CLAUDE.md's platform note — dark isn't just mood, it's the correct default for this product's actual use context.

## 2. Color system

### 2.1 Depth scale (neutrals — dark-first)

The base is dark navy, with each step lighter as it "rises" toward the surface. This is the primary mode — the one onboarding/marketing-moment screens should be designed against first. Every screen must still work in light mode (existing components already do this via Tailwind `dark:` variants) — light mode uses the same `zinc` scale already in use, unchanged.

| Token | Hex | Use |
|---|---|---|
| `--depth-0` | `#0B1220` | App background. Matches `manifest.ts` exactly — don't drift from this value. |
| `--depth-1` | `#111A2E` | Card/panel surface. |
| `--depth-2` | `#182444` | Raised surface — modal, sheet, popover. |
| `--depth-3` | `#1F2E54` | Hover/active state on a raised surface, or a selected list row. |
| `--depth-border` | `#2A3A63` | Hairline borders on dark surfaces (don't use pure-opacity white borders — they look dusty against navy; this hue keeps borders feeling like part of the same water). |

Light mode: keep using Tailwind's `zinc-50` (bg) / `white` (card) / `zinc-200` (border) exactly as `src/components/` already does. Don't invent a light-mode depth scale — there's no brand reason to, and the existing components are already correct.

### 2.2 Semantic colors (functional — already in use, now named)

These map directly to Tailwind hues already used throughout `src/components/`. **Don't introduce new hues for these meanings** — extending what's shipped is the point.

| Meaning | Tailwind hue | Where it's already used |
|---|---|---|
| Primary action / interactive | `sky` (600 light / 400–500 dark) | Buttons, links, selected states — `start-screen.tsx`, `login` |
| Success / safe / verified | `emerald` | `ProvenanceBadge` `VERIFIED`, "you're safe" states |
| Caution / pending / stale | `amber` | Pending-review states, staleness warnings, dev-only affordances |
| Danger / expired / destructive | `rose` | Safe-Return expired/alarm state, destructive confirmations — **use this consistently going forward**; it's the right Tailwind hue for this meaning but hasn't been used everywhere it should be yet |
| Community-sourced | `violet` | `ProvenanceBadge` `COMMUNITY` |
| Model-inferred | `zinc`, dashed border | `ProvenanceBadge` `MODEL_INFERRED` — deliberately muted, never confused with a real reading |
| Neutral / text / chrome | `zinc` | Everywhere |

### 2.3 The Dive Gradient — brand accent, used sparingly

```css
--gradient-dive: linear-gradient(135deg, #3B73F2 0%, #8365BE 50%, #DC577F 100%);
```

This is the one deliberately decorative element in the whole system, and it is used **sparingly, in hero moments only** — never as a general UI color. Per CLAUDE.md's product principle ("clean, low-noise... avoid noisy/growth-hacky patterns"), a gradient-everywhere interface would be a direct violation of the product's own stated values. Appropriate uses:

- The app icon/logo mark (already is one, via `dive.png`).
- A splash/hero moment in onboarding (once, at first-run).
- The single primary call-to-action on a screen that deserves a moment of weight — e.g. "Start Timer" on the Safe-Return screen, or a "Sign in with Google" button. **Not** every button — one per screen, at most.
- Never on: safety-critical status text (an expired timer, a hazard warning) — those must read as unambiguous `rose`/`amber`, not a decorative gradient. Never on data that carries meaning (provenance badges, freshness indicators) — those are semantic, not brand.

### 2.4 CSS custom properties

See `creative/design-system/tokens.css` for the drop-in implementation. It extends `src/app/globals.css`'s existing `:root`/`@theme inline` pattern rather than replacing it.

## 3. Typography

- **Body/UI text:** keep **Geist Sans** — already wired via `next/font`, free, zero migration cost, and already correct for dense UI text (logbook entries, form labels, badges).
- **Headlines/display moments** (onboarding hero, the big countdown number on the Safe-Return screen, section headers on the map): **Space Grotesk** (Google Fonts, free, self-hosted at build via `next/font/google` — no runtime request, no cost, doesn't touch the no-paid-dependency rule). Slightly geometric and instrument-panel-adjacent — it reads like something on a dive computer's display, which fits without being a costume-y "ocean" cliché font. This is a **recommendation, not yet installed** — flagged the same way other judgment calls in this codebase are flagged; confirm before wiring it into `layout.tsx`.
- Numeric/countdown displays (Safe-Return timer, depth/duration figures in logbook entries): use `tabular-nums` (already used in `running-timer-view.tsx` — keep doing this everywhere a number changes over time, so digits don't jitter the layout).

## 4. Spacing & touch targets

Keep Tailwind's default 4px spacing scale — no reason to diverge. The one hard rule, specific to this product's actual usage context (**wet or gloved hands, outdoor glare, often one-handed while carrying gear**):

- **Minimum interactive touch target: 44×44px** (iOS HIG minimum) everywhere.
- **Safety-critical controls** (Safe-Return "Start Timer", "Check in — I'm safe", "Silence alarm") — **56px minimum height**, full-width where reasonable. These are not places to save vertical space. `hold-to-confirm-button.tsx`'s existing pattern (deliberate friction against accidental taps) is correct and should extend to any other destructive/critical action.
- Generous whitespace over density. This is a low-noise, calm product, not a data-dense dashboard — resist the urge to fit more on screen at the cost of breathing room.

## 5. Iconography

- **Lucide** (MIT license, free, the standard pairing with Tailwind — no new cost or dependency risk).
- Outline style only, no filled icons (matches `dive.png`'s line-art mask), 1.5–2px stroke weight, rounded line caps.
- Icons are functional, not decorative — every icon either replaces text a user needs (a status glyph) or reinforces a label, never purely ornamental clutter. Matches the "low-noise" principle above.

## 6. Motion

- Calm and purposeful. Fades/slides under 200ms; no bounce, no elastic easing, no confetti or celebratory animation on safety-adjacent actions. **Checking in on the Safe-Return timer is a relief, not a "win"** — treat it with a quiet checkmark and a settling animation, not a burst.
- Respect `prefers-reduced-motion` everywhere — this is a straightforward accessibility requirement, not optional polish.
- The one place a slightly more expressive animation is earned: the onboarding hero moment (the Dive Gradient, once). Everywhere else, motion should be nearly invisible — present enough to feel responsive, absent enough that a diver focused on gear and safety never has to wait on it or find it distracting.

## 7. Voice & tone (content, not just visuals)

This is UX, not just UI — carried over directly from CLAUDE.md's engineering standards, restated for anyone designing copy:

- **Never imply a guarantee the system can't back.** No "help is coming," no "you'll be notified," no "fully up to date" language anywhere near the Safe-Return timer or offline-cache freshness indicators. Say plainly what's true: "This alerts you on this device only," "Cached as of 2:14 PM — may be stale."
- **No gamification, no growth-hacky urgency.** No streaks, no "you're missing out," no push-notification spam patterns. Success here is measured by safety adoption and discovery, not engagement — CLAUDE.md is explicit about this.
- **Calm authority, not cheerfulness.** This is safety-adjacent software used by people about to enter open water. Copy should be clear, warm, and direct — not chipper, not corporate. Think "a experienced dive buddy," not "an app trying to delight you."

## 8. What this document is not

It is not a component library yet — that's what `creative/mockups/` (per-flow HTML mockups) and, eventually, a real synced Design System project (via `/design-sync`, run by the founder) are for. This document is the constraint set every flow's mockups must satisfy for the results to look like one product instead of several.
