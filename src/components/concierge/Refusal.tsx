"use client";

/**
 * Refusals in the concierge's voice (XXX-43, Session 15) — Screen 5.
 *
 * What the founder used to read, verbatim from the engine:
 *
 *     ferry:hanlans does not run on this date
 *     a wanderer's day has no shape that holds a 2–3 stop spine
 *     unauthorized
 *
 * Those are correct sentences about machinery, and they were on the product
 * surface. The mechanism does not disappear — it moves one tap behind *Why?*,
 * which is where an engineer looks and a traveller does not.
 *
 * The translation is a `Record` over the infeasibility reasons rather than a
 * chain of string matches, so a fifth reason added to `ThemeInfeasibility`
 * will not compile until someone writes how to say it out loud.
 */

import { useState } from "react";
import { Button, Chip, Label } from "@/components/ui/primitives";
import type { TastingOutcome } from "@/shared/tasting";

/** Every reason a theme can refuse → what a person is told. */
const REASON_VOICE: Record<string, string> = {
  "route-out-of-season":
    "The ferry to Hanlan's Point isn't running that day.",
  weather: "The forecast is wrong for that kind of day.",
  "no-template":
    "That day needs a set route, and your days are set to wander.",
  "excluded-category":
    "That day is built around something you've asked me to skip.",
};

const REASON_OFFERS: Record<string, string[]> = {
  "route-out-of-season": ["A mainland version", "Another day"],
  weather: ["Another day", "Something indoors"],
  "no-template": ["Plan this one tightly", "Something else"],
  "excluded-category": ["Something else"],
};

export function Refusal({
  outcome,
  onRetry,
}: {
  outcome: Exclude<TastingOutcome, { status: "ok" }>;
  onRetry: () => void;
}) {
  const [why, setWhy] = useState(false);

  if (outcome.status === "theme-infeasible") {
    const voice =
      REASON_VOICE[outcome.reason] ?? "That day isn't possible then.";
    const offers = REASON_OFFERS[outcome.reason] ?? ["Something else"];
    return (
      <Frame
        line={voice}
        offers={offers}
        onRetry={onRetry}
        why={why}
        setWhy={setWhy}
        // The mechanism, kept and moved rather than deleted.
        mechanism={outcome.detail}
      />
    );
  }

  if (outcome.status === "capped") {
    return (
      <Frame
        line="That's enough days for today."
        offers={[]}
        onRetry={onRetry}
        why={why}
        setWhy={setWhy}
        mechanism={outcome.note}
      />
    );
  }

  // `failed` — the grammar loop could not land a legal day.
  return (
    <Frame
      line="I couldn't build a day I'd stand behind."
      offers={["Try again"]}
      onRetry={onRetry}
      why={why}
      setWhy={setWhy}
      mechanism={outcome.violations.map((v) => v.text).join(" ")}
      /** The refusal IS the product working. Said plainly, not apologised for. */
      footnote="I'd rather show you nothing than a day that doesn't hold up."
    />
  );
}

function Frame({
  line,
  offers,
  onRetry,
  why,
  setWhy,
  mechanism,
  footnote,
}: {
  line: string;
  offers: string[];
  onRetry: () => void;
  why: boolean;
  setWhy: (v: boolean) => void;
  mechanism?: string;
  footnote?: string;
}) {
  return (
    <div className="flex flex-col gap-7 pt-12">
      <h2 className="display text-[1.6rem]">{line}</h2>

      <div className="flex flex-wrap gap-2">
        {offers.map((o) => (
          <Chip key={o} onClick={onRetry}>
            {o}
          </Chip>
        ))}
        {mechanism !== undefined && (
          <Chip onClick={() => setWhy(!why)}>{why ? "Hide" : "Why?"}</Chip>
        )}
      </div>

      {why && mechanism !== undefined && (
        <div className="bg-sunk flex flex-col gap-2 rounded-xl p-4">
          <Label>What happened</Label>
          <p className="text-muted font-mono text-[0.75rem] leading-relaxed">
            {mechanism}
          </p>
        </div>
      )}

      {/* The sentence that earns trust, on every refusal. */}
      <p className="text-muted text-[0.82rem] font-light">
        Nothing was generated. Nothing was spent.
      </p>
      {footnote !== undefined && (
        <p className="text-muted text-[0.82rem] font-light">{footnote}</p>
      )}

      <Button variant="ghost" onClick={onRetry}>
        Start over
      </Button>
    </div>
  );
}
