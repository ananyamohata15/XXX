"use client";

/**
 * The first-run interview (XXX-43, Session 15) — Screen 2.
 *
 * Six questions, about a minute, skippable throughout. These are the five
 * dimensions the engine has always run on plus cuisines, asked in the
 * founder's language rather than ours: *"What are you into?"*, not "select
 * your gravity ordering".
 *
 * Founder direction after the first draft: *"remine the types of questions,
 * dont sound conciergey"*. So no greetings, no flourishes — the question,
 * the chips, and a way forward.
 *
 * SKIPPING IS A REAL ANSWER. An unanswered dimension is stored absent, not
 * defaulted, so the day can say "concierge's choice" rather than claiming the
 * traveller picked something they never saw.
 *
 * Card 5 is where *"I don't drink"* becomes a standing fact BY TAP — never by
 * parse. A parse is an inference, and an inference must not write a permanent
 * fact about a person (the CP1 single-owner ruling).
 */

import { useState } from "react";
import { Button, Chip, Label } from "@/components/ui/primitives";
import { CUISINE_LABELS, CUISINE_TAGS, type CuisineTag } from "@/shared/cuisine";
import { DIETARY_LABELS, DIETARY_TAGS, type DietaryTag } from "@/shared/dietary";
import { MAX_INTERESTS, type TasteProfile } from "@/shared/profile";
import {
  FOOD_COURAGES,
  INTEREST_TAGS,
  LENSES,
  PACES,
  type FoodCourage,
  type InterestTag,
  type Lens,
  type Pace,
} from "@/shared/persona";
import type { PlaceCategory } from "@/shared/vocabulary";

/** Engine words → the words a person would use. One owner, here. */
const INTEREST_WORDS: Record<InterestTag, string> = {
  food: "Food",
  local_life: "Local life",
  history: "History",
  art: "Art",
  markets: "Markets",
  nature: "Nature",
  nightlife: "Nightlife",
  sports: "Sports",
  wine: "Wine",
  shopping: "Shopping",
  views: "Views",
};

const PACE_WORDS: Record<Pace, string> = {
  relaxed: "Light",
  moderate: "Medium",
  packed: "Packed",
};

const COURAGE_WORDS: Record<FoodCourage, string> = {
  classic: "What I know",
  comfort: "In between",
  adventurous: "Anything",
};

const LENS_WORDS: Record<Lens, string> = {
  icons: "The famous ones",
  corners: "The local ones",
  icons_with_corners: "Both",
};

/**
 * Pool depth per cuisine, measured (`scripts/cuisine-report.ts`).
 *
 * Shown on the chip because the founder ruled that a preference we cannot
 * serve should say so rather than be quietly offered. These are indicative
 * counts, refreshed by the report, not a contract.
 */
const CUISINE_DEPTH: Record<CuisineTag, number> = {
  thai: 398,
  mediterranean: 1338,
  italian: 754,
  indian: 934,
  asian: 4922,
};

/** Categories a person plausibly rules out, in their own words. */
const REFUSABLE: { category: PlaceCategory; word: string }[] = [
  { category: "nightlife_bars", word: "No alcohol" },
  { category: "museums_galleries", word: "No museums" },
  { category: "shopping", word: "No shopping" },
];

const STEPS = 6;

export function Interview({
  initial,
  onDone,
  onSkip,
}: {
  initial: TasteProfile;
  onDone: (profile: TasteProfile) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<TasteProfile>(initial);

  const set = (patch: Partial<TasteProfile>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const toggleInterest = (tag: InterestTag) => {
    const current = draft.interests ?? [];
    if (current.includes(tag)) {
      set({ interests: current.filter((t) => t !== tag) });
    } else if (current.length < MAX_INTERESTS) {
      // Order is the answer, not a side effect: gravity is positional.
      set({ interests: [...current, tag] });
    }
  };

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const advance = () => {
    if (step + 1 >= STEPS) onDone(draft);
    else setStep(step + 1);
  };

  return (
    <div className="flex flex-col gap-8">
      <Label>
        {step + 1} of {STEPS}
      </Label>

      {step === 0 && (
        <Question
          title="What are you into?"
          hint="Up to three. Order matters."
        >
          {INTEREST_TAGS.map((tag) => {
            const rank = (draft.interests ?? []).indexOf(tag);
            return (
              <Chip
                key={tag}
                on={rank >= 0}
                note={rank >= 0 ? rank + 1 : undefined}
                onClick={() => toggleInterest(tag)}
              >
                {INTEREST_WORDS[tag]}
              </Chip>
            );
          })}
        </Question>
      )}

      {step === 1 && (
        <Question title="How full do you want the day?">
          {PACES.map((p) => (
            <Chip
              key={p}
              on={draft.pace === p}
              onClick={() => set({ pace: draft.pace === p ? undefined : p })}
            >
              {PACE_WORDS[p]}
            </Chip>
          ))}
        </Question>
      )}

      {step === 2 && (
        <Question title="How do you eat?">
          {FOOD_COURAGES.map((f) => (
            <Chip
              key={f}
              on={draft.foodCourage === f}
              onClick={() =>
                set({ foodCourage: draft.foodCourage === f ? undefined : f })
              }
            >
              {COURAGE_WORDS[f]}
            </Chip>
          ))}
        </Question>
      )}

      {step === 3 && (
        <Question title="Famous places, or local ones?">
          {LENSES.map((l) => (
            <Chip
              key={l}
              on={draft.lens === l}
              onClick={() => set({ lens: draft.lens === l ? undefined : l })}
            >
              {LENS_WORDS[l]}
            </Chip>
          ))}
        </Question>
      )}

      {step === 4 && (
        <Question
          title="Anything you don't do?"
          hint="This one sticks. I'll never plan around it."
        >
          {REFUSABLE.map(({ category, word }) => (
            <Chip
              key={category}
              on={draft.excludedCategories.includes(category)}
              onClick={() =>
                set({
                  excludedCategories: toggleIn(draft.excludedCategories, category),
                })
              }
            >
              {word}
            </Chip>
          ))}
          {DIETARY_TAGS.map((d: DietaryTag) => (
            <Chip
              key={d}
              on={draft.dietary.includes(d)}
              onClick={() => set({ dietary: toggleIn(draft.dietary, d) })}
            >
              {DIETARY_LABELS[d]}
            </Chip>
          ))}
        </Question>
      )}

      {step === 5 && (
        <Question
          title="What do you like to eat?"
          hint="The number is how much of it Toronto has."
        >
          {CUISINE_TAGS.map((c) => (
            <Chip
              key={c}
              on={draft.lovedCuisines.includes(c)}
              note={CUISINE_DEPTH[c]}
              onClick={() =>
                set({ lovedCuisines: toggleIn(draft.lovedCuisines, c) })
              }
            >
              {CUISINE_LABELS[c]}
            </Chip>
          ))}
        </Question>
      )}

      {/* Dietary honesty, stated where the promise could be misread. */}
      {step === 4 && draft.dietary.length > 0 && (
        <p className="text-muted text-[0.82rem] font-light">
          I lean toward places listed this way. I can&apos;t vouch for a
          kitchen — check when you get there.
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        <Button onClick={advance}>
          {step + 1 >= STEPS ? "Done" : "Next"}
        </Button>
        <Button variant="ghost" onClick={step + 1 >= STEPS ? () => onDone(draft) : onSkip}>
          {step + 1 >= STEPS ? "Skip the rest" : "Skip"}
        </Button>
      </div>
    </div>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="display text-[1.85rem]">{title}</h2>
      {hint !== undefined && (
        <p className="text-muted -mt-3 text-[0.82rem] font-light">{hint}</p>
      )}
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
