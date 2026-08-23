"use client";

/**
 * The profile sheet (XXX-43, Session 15) — Screen 6.
 *
 * **THE ONLY DOOR TO A STANDING FACT** (founder ruling, CP1). A constraint
 * typed into the chat box applies to that day; it becomes permanent only
 * here, by tap. The one-tap "always" promotion from the day screen was
 * proposed and vetoed: a permanent fact about a person should cost a
 * deliberate visit, not a stray thumb.
 *
 * Every row is removable, because a profile you cannot edit is a profile you
 * come to resent.
 */

import { Drawer } from "vaul";
import { Button, Chip, Label, Rule } from "@/components/ui/primitives";
import { CUISINE_LABELS, CUISINE_TAGS, type CuisineTag } from "@/shared/cuisine";
import { DIETARY_LABELS, type DietaryTag } from "@/shared/dietary";
import { unansweredDimensions, type TasteProfile } from "@/shared/profile";
import { categoryLabel, type PlaceCategory } from "@/shared/vocabulary";
import {
  CATEGORY_CONSTRAINT_LIMITATION,
  owesLimitationNotice,
} from "@/shared/constraints";

export function ProfileSheet({
  open,
  profile,
  onClose,
  onChange,
  onRedoInterview,
}: {
  open: boolean;
  profile: TasteProfile;
  onClose: () => void;
  onChange: (p: TasteProfile) => void;
  onRedoInterview: () => void;
}) {
  const unanswered = unansweredDimensions(profile);

  const removeCategory = (c: PlaceCategory) =>
    onChange({
      ...profile,
      excludedCategories: profile.excludedCategories.filter((x) => x !== c),
    });
  const removeCuisine = (c: CuisineTag) =>
    onChange({
      ...profile,
      lovedCuisines: profile.lovedCuisines.filter((x) => x !== c),
    });
  const removeDietary = (d: DietaryTag) =>
    onChange({ ...profile, dietary: profile.dietary.filter((x) => x !== d) });
  const addCuisine = (c: CuisineTag) =>
    onChange({ ...profile, lovedCuisines: [...profile.lovedCuisines, c] });

  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Drawer.Content className="bg-surface fixed right-0 bottom-0 left-0 z-50 mt-24 flex h-[86vh] flex-col rounded-t-[22px] outline-none">
          <div className="bg-hair-2 mx-auto mt-3 h-1 w-10 shrink-0 rounded-full" />
          <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-6 pt-6 pb-10">
            <Drawer.Title className="display mb-1 text-[1.6rem]">
              What I know about you
            </Drawer.Title>
            <Drawer.Description className="text-muted mb-8 text-[0.86rem] font-light">
              Only what you&apos;ve told me. Nothing here was guessed.
            </Drawer.Description>

            <div className="flex flex-col gap-8">
              <Section label="Never">
                {profile.excludedCategories.length === 0 ? (
                  <Empty>Nothing ruled out.</Empty>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {profile.excludedCategories.map((c) => (
                        <Chip key={c} on onRemove={() => removeCategory(c)}>
                          No {categoryLabel(c)}
                        </Chip>
                      ))}
                    </div>
                    {/* The edge of the promise, stated where the promise is
                        made. Honest limits beat silent ones (XXX-44). */}
                    {owesLimitationNotice(profile.excludedCategories) && (
                      <p className="text-muted mt-3 text-[0.78rem] font-light">
                        {CATEGORY_CONSTRAINT_LIMITATION}
                      </p>
                    )}
                  </>
                )}
              </Section>

              <Section label="Eating">
                {profile.dietary.length === 0 ? (
                  <Empty>Nothing stated.</Empty>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {profile.dietary.map((d) => (
                        <Chip key={d} on onRemove={() => removeDietary(d)}>
                          {DIETARY_LABELS[d]}
                        </Chip>
                      ))}
                    </div>
                    {/* The promise, kept honest at the point it could be misread. */}
                    <p className="text-muted mt-3 text-[0.78rem] font-light">
                      I lean toward places listed this way. I can&apos;t vouch
                      for a kitchen.
                    </p>
                  </>
                )}
              </Section>

              <Section label="Cuisines">
                <div className="flex flex-wrap gap-2">
                  {CUISINE_TAGS.map((c) => {
                    const on = profile.lovedCuisines.includes(c);
                    return (
                      <Chip
                        key={c}
                        on={on}
                        onClick={() => (on ? removeCuisine(c) : addCuisine(c))}
                      >
                        {CUISINE_LABELS[c]}
                      </Chip>
                    );
                  })}
                </div>
              </Section>

              <Section label="Your days">
                <p className="text-ink-2 text-[0.9rem] font-light">
                  {describePersona(profile)}
                </p>
                {/* Honest absence, per dimension — never a default presented
                    as a choice the traveller made. */}
                {unanswered.length > 0 && (
                  <p className="text-muted mt-2 text-[0.78rem] font-light">
                    You haven&apos;t told me about {unanswered.join(", ")} — I
                    choose for those.
                  </p>
                )}
              </Section>

              <Rule />
              <Button variant="ghost" onClick={onRedoInterview}>
                Answer the questions again
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted text-[0.85rem] font-light">{children}</p>
);

const PACE_WORD = { relaxed: "light", moderate: "medium", packed: "packed" };
const COURAGE_WORD = {
  classic: "sticking to what you know",
  comfort: "somewhere in between",
  adventurous: "trying anything",
};
const LENS_WORD = {
  icons: "the famous ones",
  corners: "the local ones",
  icons_with_corners: "both",
};

function describePersona(p: TasteProfile): string {
  const bits: string[] = [];
  if (p.interests && p.interests.length > 0) {
    bits.push(p.interests.map((i) => i.replace("_", " ")).join(", then "));
  }
  if (p.pace) bits.push(`${PACE_WORD[p.pace]} days`);
  if (p.foodCourage) bits.push(COURAGE_WORD[p.foodCourage]);
  if (p.lens) bits.push(LENS_WORD[p.lens]);
  return bits.length > 0 ? bits.join(" · ") : "You haven't said yet.";
}
