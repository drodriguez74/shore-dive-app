// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimListing } from "./claim-listing";

/**
 * The "Claim this listing" affordance (Task 16, `plan.md` v5: *"a documented
 * (if manual/founder-run) claim process, and a visible 'Claim this listing'
 * affordance telling a shop owner the process exists at all"*).
 *
 * Every assertion here is about not overselling a process that is one person
 * reading an inbox: no implied automation, no implied turnaround, no implied
 * listing control, and — in this build, where `NEXT_PUBLIC_LDS_CLAIM_EMAIL`
 * is unset — no dead `mailto:` link pointed at nobody.
 *
 * Note the env var is read at module scope (Next inlines `NEXT_PUBLIC_*` at
 * build time), so these tests assert the unset-in-this-build behavior rather
 * than trying to toggle `process.env` per test, which wouldn't reflect how
 * the value actually reaches the bundle.
 */

afterEach(cleanup);

describe("ClaimListing", () => {
  it("is visible and collapsed by default, so a shop owner can find it without it shouting", () => {
    render(<ClaimListing shopName="Blue Water Divers" />);

    const trigger = screen.getByRole("button", { name: /own this shop\? claim this listing/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Claiming is/)).toBeNull();
  });

  it("says the process is manual, with no promised turnaround", () => {
    render(<ClaimListing shopName="Blue Water Divers" />);
    fireEvent.click(screen.getByRole("button", { name: /claim this listing/i }));

    expect(screen.getByText(/no automated claim flow/)).toBeTruthy();
    expect(screen.getByText(/no turnaround time anyone can promise you/)).toBeTruthy();
  });

  it("does not imply claiming gives the owner control of the listing", () => {
    render(<ClaimListing shopName="Blue Water Divers" />);
    fireEvent.click(screen.getByRole("button", { name: /claim this listing/i }));

    expect(screen.getByText(/give you an account that controls this listing/)).toBeTruthy();
    expect(screen.getByText(/doesn't exist yet/)).toBeTruthy();
  });

  it("renders no dead mailto link while no claim address is configured", () => {
    render(<ClaimListing shopName="Blue Water Divers" />);
    fireEvent.click(screen.getByRole("button", { name: /claim this listing/i }));

    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.getByText(/isn't published in this build yet/)).toBeTruthy();
  });
});
