import { createClient } from "@supabase/supabase-js";
import { createEngineGoogleClient, PLACE_DETAILS_ENTERPRISE_USD_PER_CALL } from "@/server/generation/google";
import { judgeAndPersistLink, linkSearchQuery, linkSearchBias } from "@/server/generation/links";
import type { Candidate } from "@/server/generation/types";
import { createInstrumentation } from "@/server/instrumentation";
import { normalizeName } from "@/shared/anchor-calibre";
import { DISTRICTS } from "@/shared/districts";
import { haversineKm } from "@/shared/day-grammar/travel";

/**
 * Mint links for named pool identities (XXX-41, Session 16 CP4).
 *
 * WHAT IT COSTS AND WHY. The id search is free (IDs-only text search, $0).
 * The Details call that supplies the display name is $0.02, and it is not
 * optional: Session 5's ratified matching decides the link on a NAME
 * comparison, and a link written without one would be an identity claim we
 * did not check. Reported per venue, not assumed.
 *
 * DRY BY DEFAULT. Linking writes to `places.google_place_id`,
 * `discovered_places` and `identity_matches`. Pass `--write` to persist;
 * without it nothing is written and the report is the worksheet.
 *
 * WHAT IT CANNOT FIX, stated at the top because it is the finding: a link is
 * worth +0.020 of score (freshness 0.4 → 0.6, weight 0.1) against a jitter
 * bound of ±0.04. And a venue outside every district is never retrieved at
 * all, so a link on it changes nothing whatsoever. See
 * `scripts/shopping-seed.ts` for the measurement.
 *
 *   npx tsx --env-file=.env.local scripts/link-curated.ts "CF Toronto Eaton Centre" [--write]
 */

const line = (s = "") => console.log(s);
const write = process.argv.includes("--write");

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (names.length === 0) {
    console.error('Pass one or more pool spellings: link-curated.ts "CF Toronto Eaton Centre"');
    process.exit(1);
  }
  const supabase = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const google = createEngineGoogleClient({ apiKey: need("GOOGLE_MAPS_API_KEY") });
  const instrumentation = createInstrumentation(supabase);
  const traceId = await instrumentation.startTrace("identity_matching", {
    script: "link-curated",
    write,
  });

  let spent = 0;
  line(write ? "MODE: --write (links will be persisted)" : "MODE: dry run (nothing is written)");

  for (const wanted of names) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, lat, lng, google_place_id")
      .eq("city", "toronto")
      .ilike("name", `%${wanted.split(/\s+/).sort((a, b) => b.length - a.length)[0]}%`)
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).filter(
      (r) => normalizeName(r.name as string) === normalizeName(wanted),
    ) as { id: string; name: string; lat: number; lng: number; google_place_id: string | null }[];

    line();
    line(`── "${wanted}" — ${rows.length} exact match(es)`);
    for (const row of rows) {
      const inside = DISTRICTS.filter(
        (d) =>
          haversineKm({ lat: row.lat, lng: row.lng }, { lat: d.lat, lng: d.lng }) *
            1000 <=
          d.radiusM,
      );
      if (row.google_place_id !== null) {
        line(`   already linked (${row.google_place_id}) — nothing to do`);
        continue;
      }
      if (inside.length === 0) {
        // Refusing to spend on a venue the engine can never retrieve is the
        // point of checking first. A link here would be a purchase with no
        // reachable effect.
        line(
          `   SKIPPED — outside every district, so retrieval never queries it. A link would change nothing.`,
        );
        continue;
      }
      const candidate = {
        place: {
          id: row.id,
          name: row.name,
          neighborhood: inside[0].label,
          coords: { lat: row.lat, lng: row.lng },
        },
      } as Candidate;
      const googlePlaceId = await google.searchPlaceId(
        linkSearchQuery(candidate),
        linkSearchBias(candidate),
      );
      line(`   id search → ${googlePlaceId ?? "no result"}  ($0, ids-only)`);
      if (googlePlaceId === null) continue;
      const details = await google.getDetails(googlePlaceId);
      spent += PLACE_DETAILS_ENTERPRISE_USD_PER_CALL;
      // `details.ts:151` reads the same path — one shape, read the same way.
      const googleName = details.displayName?.text ?? null;
      line(`   details → name "${googleName ?? "(none)"}"  ($${PLACE_DETAILS_ENTERPRISE_USD_PER_CALL})`);
      if (!write) {
        line(`   would judge and persist — dry run, stopping here`);
        continue;
      }
      const verdict = await judgeAndPersistLink(
        supabase,
        "toronto",
        candidate,
        googlePlaceId,
        googleName,
        { lat: row.lat, lng: row.lng },
        traceId,
        () => new Date(),
      );
      line(
        `   VERDICT ${verdict.status} (score ${verdict.bestScore.toFixed(3)})` +
          (verdict.status === "matched_confirmed"
            ? " — link written"
            : " — no link written, the candidate stays honest-absence"),
      );
    }
  }

  await instrumentation.endTrace(traceId, { totalCostUsd: spent });
  line();
  line(`spent: $${spent.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
