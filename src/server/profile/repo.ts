/**
 * Profile persistence (XXX-43, Session 15).
 *
 * One row, founder-singular until XXX-17 lands an identity model. The repo
 * pins provenance so callers cannot claim otherwise — the same discipline
 * `base-layer/repo.ts` applies to place facts, for the same reason: a tier is
 * a claim about where knowledge came from, and a caller must not be able to
 * assert it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCuisineTag, type CuisineTag } from "@/shared/cuisine";
import { isDietaryTag, type DietaryTag } from "@/shared/dietary";
import {
  EMPTY_PROFILE,
  isFoodCourage,
  isInterestTag,
  isLens,
  isPace,
  MAX_INTERESTS,
  type TasteProfile,
} from "@/shared/profile";
import { PLACE_CATEGORIES, type PlaceCategory } from "@/shared/vocabulary";

/** The single profile until XXX-17 gives people their own. */
export const FOUNDER_OWNER = "founder";

interface ProfileRow {
  owner: string;
  pace: string | null;
  gravity: string[] | null;
  food_courage: string | null;
  structure: string | null;
  lens: string | null;
  excluded_categories: string[] | null;
  dietary: string[] | null;
  loved_cuisines: string[] | null;
  stated_at: string;
}

const isPlaceCategory = (v: string): v is PlaceCategory =>
  (PLACE_CATEGORIES as readonly string[]).includes(v);

const isStructure = (v: string): v is "scheduler" | "wanderer" =>
  v === "scheduler" || v === "wanderer";

/**
 * Row → `TasteProfile`, dropping anything the vocabulary no longer knows.
 *
 * DROPPING RATHER THAN THROWING is the deliberate choice, and it is what the
 * absent SQL CHECK buys us. A stored value can fall out of the vocabulary —
 * a category renamed, a cuisine retired — and when it does, the honest
 * behaviour is that the traveller has one fewer stated preference, not that
 * their profile becomes unreadable and their day cannot be built. The
 * vocabulary has one owner (`src/shared/vocabulary.ts`) and this is where a
 * row is reconciled to it.
 *
 * A dropped value is not silent: `readProfile` returns the count so a caller
 * can surface it, because a preference that quietly stopped applying is
 * exactly the kind of thing this codebase has been bitten by.
 */
function toProfile(row: ProfileRow): {
  profile: TasteProfile;
  droppedValues: string[];
} {
  const dropped: string[] = [];
  const keep = <T extends string>(
    values: string[] | null,
    guard: (v: string) => v is T,
  ): T[] => {
    const out: T[] = [];
    for (const v of values ?? []) {
      if (guard(v)) out.push(v);
      else dropped.push(v);
    }
    return out;
  };

  const interests = keep(row.gravity, isInterestTag).slice(0, MAX_INTERESTS);

  const profile: TasteProfile = {
    ...(interests.length > 0 ? { interests } : {}),
    ...(row.pace !== null && isPace(row.pace) ? { pace: row.pace } : {}),
    ...(row.food_courage !== null && isFoodCourage(row.food_courage)
      ? { foodCourage: row.food_courage }
      : {}),
    ...(row.lens !== null && isLens(row.lens) ? { lens: row.lens } : {}),
    ...(row.structure !== null && isStructure(row.structure)
      ? { structure: row.structure }
      : {}),
    excludedCategories: keep<PlaceCategory>(
      row.excluded_categories,
      isPlaceCategory,
    ),
    dietary: keep<DietaryTag>(row.dietary, isDietaryTag),
    lovedCuisines: keep<CuisineTag>(row.loved_cuisines, isCuisineTag),
  };
  return { profile, droppedValues: dropped };
}

/**
 * The traveller's standing facts, or the empty profile.
 *
 * A missing row is NOT an error: it means this person has told us nothing
 * yet, which is the state every user starts in and the state the
 * byte-identity gate protects.
 */
export async function readProfile(
  client: SupabaseClient,
  owner: string = FOUNDER_OWNER,
): Promise<{ profile: TasteProfile; droppedValues: string[] }> {
  const { data, error } = await client
    .from("profiles")
    .select(
      "owner, pace, gravity, food_courage, structure, lens, excluded_categories, dietary, loved_cuisines, stated_at",
    )
    .eq("owner", owner)
    .maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  if (data === null) return { profile: EMPTY_PROFILE, droppedValues: [] };
  return toProfile(data as ProfileRow);
}

/**
 * Write the traveller's standing facts.
 *
 * Called ONLY by the interview and the profile sheet. Never by the chat
 * parser — the single-owner ruling (CP1): a parse is an inference, and an
 * inference must not write a permanent fact about a person.
 *
 * A full overwrite rather than a merge, because the profile sheet shows the
 * whole profile: what the user submits IS their profile, and a merge would
 * make removing a preference impossible.
 */
export async function writeProfile(
  client: SupabaseClient,
  profile: TasteProfile,
  owner: string = FOUNDER_OWNER,
): Promise<void> {
  const { error } = await client.from("profiles").upsert(
    {
      owner,
      pace: profile.pace ?? null,
      gravity: profile.interests ?? null,
      food_courage: profile.foodCourage ?? null,
      structure: profile.structure ?? null,
      lens: profile.lens ?? null,
      excluded_categories: profile.excludedCategories,
      dietary: profile.dietary,
      loved_cuisines: profile.lovedCuisines,
      // The repo pins provenance — a caller cannot claim a different tier.
      source: "user:interview",
      tier: 1,
      stated_at: new Date().toISOString(),
    },
    { onConflict: "owner" },
  );
  if (error) throw new Error(`profile write failed: ${error.message}`);
}
