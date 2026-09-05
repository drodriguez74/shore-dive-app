/**
 * DAN (Divers Alert Network) emergency-hotline reference — `plan.md`'s
 * "Safety first" pillar, v5 addendum: *"DAN's emergency hotline is the actual
 * resource trained divers are taught to use in a real dive emergency, not a
 * generic contact."*
 *
 * Single-sourced on purpose. This is a real, dialable emergency number that
 * renders on more than one Safe-Return surface (the pre-start disclaimer gate
 * and the expired/alarm view); two hand-written copies of a phone number is
 * exactly the kind of thing that silently drifts, and a wrong number on this
 * particular screen is worse than no number at all. Anything that needs to
 * show it imports from here — never retypes it.
 *
 * Number verified 2026-08-21 against DAN's own published emergency page
 * (https://dan.org/emergency/): +1-919-684-9111, staffed 24/7, collect calls
 * accepted. DAN's own instruction is to call local EMS *first* and DAN
 * second, which is why that ordering is in the copy — sending a diver to a
 * consultation line ahead of an ambulance would be an actively harmful
 * "improvement" to this disclaimer.
 *
 * Renders as color-inheriting body text with no container of its own, so the
 * same copy sits correctly inside the amber disclaimer box and the rose
 * expired-alarm panel without a second styling variant to keep in sync. The
 * caller owns the container and spacing.
 */

/** Dial string for the `tel:` href. E.164, no punctuation. */
export const DAN_EMERGENCY_TEL = "+19196849111";

/** Human-readable form. Also the link text, so the number stays visible and
 *  copyable on a desktop browser with no dialer to hand off to. */
export const DAN_EMERGENCY_DISPLAY = "+1-919-684-9111";

interface DanEmergencyReferenceProps {
  className?: string;
}

export function DanEmergencyReference({ className = "" }: DanEmergencyReferenceProps) {
  return (
    <p className={`text-xs leading-relaxed ${className}`}>
      In a real dive emergency, call local emergency services first (911 in the US).
      Then call DAN — the Divers Alert Network — on its 24-hour dive emergency
      hotline,{" "}
      <a
        href={`tel:${DAN_EMERGENCY_TEL}`}
        className="font-semibold underline underline-offset-2"
      >
        {DAN_EMERGENCY_DISPLAY}
      </a>
      . It is staffed around the clock and accepts collect calls. This app does not
      contact either of them for you.
    </p>
  );
}
