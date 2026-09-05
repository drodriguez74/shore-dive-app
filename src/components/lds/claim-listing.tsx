"use client";

import { useState } from "react";

/**
 * "Own this shop? Claim this listing" (Task 16, `plan.md` v5 addendum:
 * *"Today there is no form, self-service or otherwise, that produces a
 * `VERIFIED` LDS row — only the founder running SQL directly, and that path
 * isn't even named anywhere as existing. Minimum fix: a documented (if
 * manual/founder-run) claim process, and a visible 'Claim this listing'
 * affordance telling a shop owner the process exists at all."*).
 *
 * Deliberately minimal, per that framing: **no new backend, no new table, no
 * automated flow.** This is a disclosure, not a feature — its entire job is
 * to stop the claim process from being invisible to the only people who can
 * use it. A shop owner currently has no way to know that `VERIFIED` exists,
 * that it's reachable, or that a human is on the other end.
 *
 * Honesty constraints this component exists under (CLAUDE.md — "never let a
 * UI imply a guarantee the system can't back"):
 *   - It must not look like a form that submits somewhere. It's an email
 *     link, because that's genuinely all that's behind it.
 *   - It must say the process is manual and has no SLA. One person runs
 *     this project; promising a turnaround would be inventing one.
 *   - It must not imply claiming grants control of the listing. It doesn't:
 *     the founder runs an `update ... set provenance = 'VERIFIED'` by hand
 *     (`supabase/README.md` — there is no moderator role modeled, and
 *     promotion requires the service-role key). A shop-controlled listing
 *     page is a separate, unbuilt item in the same addendum.
 *
 * Contact address comes from `NEXT_PUBLIC_LDS_CLAIM_EMAIL`. It is read at
 * module scope on purpose: `process.env.NEXT_PUBLIC_*` is inlined at build
 * time by Next, so this is a literal in the client bundle, not a runtime
 * lookup. **Unset in this build** — the fallback below drops the `mailto:`
 * link entirely rather than rendering a dead one into the void, which would
 * be a worse lie than saying plainly that the address isn't published yet.
 * Set it before shipping this to real shop owners.
 */

const CLAIM_EMAIL = (process.env.NEXT_PUBLIC_LDS_CLAIM_EMAIL ?? "").trim();

export interface ClaimListingProps {
  shopName: string;
  className?: string;
}

export function ClaimListing({ shopName, className = "" }: ClaimListingProps) {
  const [open, setOpen] = useState(false);

  // Prefilled so the founder gets the three things a manual promotion
  // actually needs (which shop, who's asking, and something checkable) in
  // the first email instead of a round trip. `encodeURIComponent` on both
  // parts — a shop name with an `&` or `#` would otherwise truncate the body.
  const mailto = CLAIM_EMAIL
    ? `mailto:${CLAIM_EMAIL}?subject=${encodeURIComponent(
        `Claim listing: ${shopName}`,
      )}&body=${encodeURIComponent(
        [
          `Shop: ${shopName}`,
          "",
          "My name and role at the shop:",
          "A way to verify I'm connected to the shop (shop website, shop email address, phone number listed publicly):",
          "",
          "(Shore Dive is run by one person and claims are reviewed by hand — there's no automated verification behind this.)",
        ].join("\n"),
      )}`
    : null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="min-h-[24px] text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
      >
        Own this shop? Claim this listing
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-2.5 text-xs leading-relaxed text-zinc-600 dark:border-depth-border dark:bg-depth-2 dark:text-zinc-400">
          <p>
            Claiming is <span className="font-medium">manual</span>. Shore Dive is run by one person — there
            is no automated claim flow, no account role for shop owners, and no turnaround time anyone can
            promise you.
          </p>
          <p className="mt-1.5">
            What it gets you: status you report for {shopName} can be marked{" "}
            <span className="font-medium">Verified</span> instead of Community, which is the difference
            between a diver treating your hours as a rumor and as fact. It does{" "}
            <span className="font-medium">not</span> give you an account that controls this listing — that
            doesn&apos;t exist yet.
          </p>
          {mailto ? (
            <p className="mt-1.5">
              <a href={mailto} className="font-semibold text-violet-700 underline dark:text-violet-400">
                Email to start a claim
              </a>{" "}
              — include something that shows you&apos;re connected to the shop.
            </p>
          ) : (
            <p className="mt-1.5">
              A contact address for claims isn&apos;t published in this build yet, so there&apos;s nothing to
              email right now. This notice is here so shop owners know the process exists rather than
              discovering nothing at all.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
