/**
 * Seed the city-scoped facts (XXX-38, Session 14).
 *
 * FREE and idempotent: one upsert of the founder-verified ferry timetable,
 * keyed on (city, fact_kind, subject_key, valid_from). No Google, no
 * Anthropic. Re-running it re-states the same fact rather than duplicating
 * it, so it is safe to run before every live set.
 *
 *   npx tsx --env-file=.env.local scripts/seed-city-facts.ts [--verify]
 */

import { createClient } from "@supabase/supabase-js";
import { readFerryTimetable, upsertCityFact } from "@/server/city-facts/repo";
import {
  FERRY_HANLANS_ROUTE_KEY,
  FERRY_HANLANS_SUMMER_2026,
} from "@/server/city-facts/ferry-seed";
import { lastDeparture, nextDeparture } from "@/shared/city-facts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const client = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  await upsertCityFact(client, FERRY_HANLANS_SUMMER_2026);
  console.log(
    `upserted ${FERRY_HANLANS_SUMMER_2026.factKind} ${FERRY_HANLANS_ROUTE_KEY}` +
      ` (${FERRY_HANLANS_SUMMER_2026.validFrom} → ${FERRY_HANLANS_SUMMER_2026.validTo},` +
      ` ${FERRY_HANLANS_SUMMER_2026.source} tier ${FERRY_HANLANS_SUMMER_2026.tier})`,
  );

  // READ IT BACK through the same boundary the engine uses. A seed that
  // cannot be read is a seed that is not there — the PostgREST
  // false-healthy lesson, applied to a write.
  const inSeason = await readFerryTimetable(
    client,
    "toronto",
    FERRY_HANLANS_ROUTE_KEY,
    "2026-07-18",
  );
  const winter = await readFerryTimetable(
    client,
    "toronto",
    FERRY_HANLANS_ROUTE_KEY,
    "2026-01-17",
  );

  console.log(
    `  mid-July read-back : ${inSeason === null ? "ABSENT (wrong)" : `${inSeason.value.outbound.length} out / ${inSeason.value.inbound.length} in, last boat ${lastDeparture(inSeason.value.inbound)}`}`,
  );
  console.log(
    `  crossing at 11:30  : ${inSeason === null ? "-" : nextDeparture(inSeason.value.outbound, "11:30")}`,
  );
  console.log(
    `  mid-Jan read-back  : ${winter === null ? "ABSENT (correct — the route does not run)" : "PRESENT (wrong)"}`,
  );

  if (inSeason === null || winter !== null) {
    console.error("\nseason gate is not behaving — refusing to report success");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
