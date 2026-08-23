import { z } from "zod";
import { getServerSupabase } from "@/server/supabase";
import { checkGate, gateResponse } from "@/server/tasting/gate";
import { readProfile, writeProfile } from "@/server/profile/repo";
import { CUISINE_TAGS } from "@/shared/cuisine";
import { DIETARY_TAGS } from "@/shared/dietary";
import { MAX_INTERESTS, type TasteProfile } from "@/shared/profile";
import { FOOD_COURAGES, INTEREST_TAGS, LENSES, PACES } from "@/shared/persona";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

/**
 * The traveller's standing facts (XXX-43, Session 15).
 *
 * Free — two DB queries, no provider calls — so it is deliberately NOT behind
 * the daily generation guard, on the same reasoning the quota route records:
 * refusing to show someone what they told us about themselves because they
 * have spent too much today would be the wrong way round.
 */

export const dynamic = "force-dynamic";

/**
 * Every field validated against the SHARED vocabulary (parse, don't
 * validate-and-hope). This is the gate the migration deliberately does not
 * duplicate in SQL — one owner for the vocabulary, and it is this one.
 */
const bodySchema = z.strictObject({
  interests: z.array(z.enum(INTEREST_TAGS)).max(MAX_INTERESTS).optional(),
  pace: z.enum(PACES).optional(),
  foodCourage: z.enum(FOOD_COURAGES).optional(),
  lens: z.enum(LENSES).optional(),
  structure: z.enum(["scheduler", "wanderer"]).optional(),
  excludedCategories: z.array(z.enum(PLACE_CATEGORIES)),
  dietary: z.array(z.enum(DIETARY_TAGS)),
  lovedCuisines: z.array(z.enum(CUISINE_TAGS)),
});

export async function GET(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  try {
    const { profile, droppedValues } = await readProfile(getServerSupabase());
    return Response.json(
      // `droppedValues` travels with the profile rather than being logged and
      // forgotten: a stored preference that quietly stopped applying is
      // exactly the kind of silence this codebase has been bitten by.
      { profile, droppedValues },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("profile read failed:", message);
    return Response.json({ error: "profile read failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const verdict = checkGate(request);
  if (!verdict.ok) return gateResponse(verdict);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "malformed body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "profile rejected", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  try {
    // A full overwrite: the sheet shows the whole profile, so what the user
    // submits IS their profile. A merge would make removal impossible.
    await writeProfile(getServerSupabase(), parsed.data as TasteProfile);
    const { profile } = await readProfile(getServerSupabase());
    return Response.json({ profile }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("profile write failed:", message);
    return Response.json({ error: "profile write failed" }, { status: 500 });
  }
}
