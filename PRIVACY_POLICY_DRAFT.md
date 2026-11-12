# Privacy policy — DRAFT for founder review

**Status: not published, not legal advice.** Written from what the code and
`supabase/README.md` actually do as of 2026-11-11, so the facts are checkable,
but it has not been reviewed by a lawyer. Bracketed items need your decision
before this goes anywhere public. `plan.md` lists "Privacy policy" as a
blocked founder decision — this draft is the input to that decision, not the
decision.

---

## Shore Dive privacy policy

_Last updated: [date]_

Shore Dive is a free, non-commercial app for finding and planning shore
dives, run by [name / entity]. We don't sell data, show ads, or use
analytics trackers.

### What we collect

**If you just browse (no account):** nothing tied to you. Your location, if
you allow it, is used in your browser to centre the map and is sent to our
server only as the coordinates of a "sites near here" search. We don't store
it against you.

**If you sign in with Google:** we receive your Google account's email
address and a user ID, used only to sign you in.

**Things you choose to add:**

- _Dive plans_ — the site, date, optional time window and optional "diving
  with" note. Private to you.
- _Community contributions_ — sites, hazard reports and fill-station status
  you submit. These are public, and are linked to your account internally.
- _Dive-log backup (off unless you turn it on)_ — your logbook entries:
  depth, time, conditions, marine life, notes, and a buddy's name if you
  typed one. Private to you. Your voice recording and its transcript are
  never uploaded.

**Stored only on your device, never sent to us:** the Safe-Return timer,
your dive logs (unless you turn on backup), sites saved for offline use, and
your map preferences.

### Voice logging

Speech-to-text uses your browser's speech recognition. On many browsers that
means the audio is processed by the browser maker's servers (for example
Google or Apple), not on your device. The app tells you which applies when it
can detect it. We never receive the audio.

### Who else is involved

- **Supabase** — hosts our database and sign-in.
- **Vercel** — hosts the app; its servers see standard request data such as
  IP address.
- **Google** — sign-in.
- **Mapbox** — draws the map; your browser requests map tiles from it.
- **OpenStreetMap / Overpass, Brave Search, Google Gemini** — when a signed-in
  user searches an area with little data, we send the area's coordinates or
  place name (not your identity) to look for dive sites.

### How long we keep it

- Your account, dive plans and dive-log backup are kept until you delete
  your account, then removed.
- Public contributions stay on the map after account deletion, with your
  account link removed, because other divers may be relying on them
  (for example a hazard report). [Confirm this is the policy you want.]

### Your choices

- Use the app without an account.
- Turn dive-log backup off at any time; [backed-up entries can be deleted on
  request — there is no in-app delete yet].
- Ask us to delete your account and data: [contact email].

### Safety note

The Safe-Return timer runs only on your device and does not notify anyone.
Nothing in this app shares your location with emergency contacts or anyone
else.

### Changes

We'll update this page and its date when practices change.

---

## Open decisions before publishing

1. Who is the data controller (your name, or an entity)?
2. A contact email for privacy requests.
3. Keep or delete public contributions on account deletion (currently kept, de-attributed).
4. Whether to add an in-app "delete my dive-log backup" control first.
5. Whether you need region-specific wording (GDPR / CCPA) — depends on where users are.
