import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSkeleton } from "@/server/generation/compose";
import { POOL_WINDOWS, retrieveCandidates, zonesFor } from "@/server/generation/retrieve";
import { scoreAll } from "@/server/generation/score";
import { pickShortlist } from "@/server/generation/engine";
import type { Candidate, GenerationRequest } from "@/server/generation/types";
import { normalizeName } from "@/shared/anchor-calibre";
import { FOUNDER_ANCHOR_WORTHY } from "@/shared/anchor-calibre";
import { districtBySlug, DISTRICTS } from "@/shared/districts";
import { haversineKm } from "@/shared/day-grammar/travel";
import { diceIndex, diceStream, personaIdentity } from "@/shared/dice";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import { PLACE_CATEGORIES } from "@/shared/vocabulary";

/**
 * The shopping seed run (XXX-41, Session 16 CP4).
 *
 * The founder named seven destinations and got none of them. This resolves
 * each against the pool, sorts them into the THREE DIFFERENT GAPS they turn
 * out to be, and then answers the question the ticket actually asks:
 * **would linking them be enough?**
 *
 * FREE and read-only: pool reads only. No Google, no Anthropic, no writes.
 * The linking itself is a separate, reviewed step — this is the worksheet the
 * founder red-pens before anything is written.
 *
 *   npx tsx --env-file=.env.local scripts/shopping-seed.ts
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 62 - s.length))}`);
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

/**
 * The founder's list, verbatim from the CP4 complaint, plus the spellings the
 * pool actually uses where they differ. A curated name must carry the pool's
 * own spelling — matching is exact-normalized — so "the name he says" and
 * "the name the row has" are both recorded rather than one silently replacing
 * the other.
 */
const NAMED: { said: string; poolSpelling?: string; kind: "venue" | "district" }[] = [
  { said: "Eaton Centre", poolSpelling: "CF Toronto Eaton Centre", kind: "venue" },
  { said: "Holt Renfrew", kind: "venue" },
  { said: "Yorkdale", poolSpelling: "Yorkdale Shopping Centre", kind: "venue" },
  { said: "Sherway Gardens", kind: "venue" },
  { said: "outlet malls", poolSpelling: "Toronto Premium Outlets", kind: "venue" },
  { said: "Yorkville", kind: "district" },
  { said: "Queen St W", kind: "district" },
];

interface Row {
  id: string;
  name: string;
  google_place_id: string | null;
  facts: { fact_key: string; value: { mapped?: string[] } }[];
}

async function rowsNamed(
  client: SupabaseClient,
  token: string,
): Promise<Row[]> {
  const { data, error } = await client
    .from("places")
    .select("id, name, google_place_id, facts(fact_key, value)")
    .eq("city", "toronto")
    .ilike("name", `%${token}%`)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Row[];
}

async function coordsOf(
  client: SupabaseClient,
  id: string,
): Promise<{ lat: number; lng: number }> {
  const { data, error } = await client
    .from("places")
    .select("lat, lng")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as { lat: number; lng: number };
}

const mappedOf = (r: Row): string[] =>
  r.facts?.find((f) => f.fact_key === "categories")?.value?.mapped ?? [];

async function main(): Promise<void> {
  const client = createClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  head("the founder's list, resolved — FOUR different gaps");
  const unlinked: Row[] = [];
  for (const entry of NAMED) {
    const wanted = entry.poolSpelling ?? entry.said;
    if (entry.kind === "district") {
      const district = districtBySlug(
        entry.said === "Yorkville" ? "yorkville" : "queen_west_ossington",
      );
      line(
        `  ZONE, NOT A VENUE   "${entry.said}" → district \`${district?.slug}\` (${district?.label})`,
      );
      line(
        `                      reachable since Session 16 CP3 as a zone day: theme \`zone:${district?.slug}\``,
      );
      continue;
    }
    const token = wanted.split(/\s+/).sort((a, b) => b.length - a.length)[0];
    const rows = await rowsNamed(client, token.replace(/[^A-Za-z0-9]/g, ""));
    const exact = rows.filter(
      (r) => normalizeName(r.name) === normalizeName(wanted),
    );
    if (exact.length === 0) {
      line(`  ABSENT              "${entry.said}" — no pool identity spells it`);
      const tenants = rows.filter((r) => mappedOf(r).includes("shopping"));
      line(
        `                      ${rows.length} rows contain "${token}", ${tenants.length} of them shopping — tenants, not the mall`,
      );
      continue;
    }
    for (const row of exact) {
      const cats = mappedOf(row);
      unlinked.push(...(row.google_place_id === null ? [row] : []));
      /**
       * WHERE IT IS, asked because a name match is not a venue match.
       *
       * Session 15 recorded "Holt Renfrew — PRESENT ×2, electable today". Both
       * rows are suburban: one in Vaughan, one in Mississauga. The Bloor
       * Street flagship he means is not in the pool at all. A resolver that
       * matches on NAME and reports presence, with nobody checking the
       * coordinates, gives a confident wrong answer — the same shape as the
       * Yorkdale absence, arrived at from the opposite direction.
       *
       * And a venue outside every district is unreachable no matter how well
       * it is linked or curated: retrieval never queries there.
       */
      const coords = await coordsOf(client, row.id);
      const inside = DISTRICTS.filter(
        (d) => haversineKm(coords, { lat: d.lat, lng: d.lng }) * 1000 <= d.radiusM,
      );
      const nearest = DISTRICTS.map((d) => ({
        d,
        km: haversineKm(coords, { lat: d.lat, lng: d.lng }),
      })).sort((a, b) => a.km - b.km)[0];
      line(
        `  PRESENT             "${row.name}"  [${cats.join("/")}]  ${row.google_place_id === null ? "UNLINKED" : "linked"}` +
          (entry.poolSpelling !== undefined
            ? `   (he says "${entry.said}")`
            : ""),
      );
      line(
        inside.length > 0
          ? `                      inside \`${inside.map((d) => d.slug).join(", ")}\` — retrieval can reach it`
          : `                      ⚠ OUTSIDE EVERY DISTRICT — ${nearest.km.toFixed(1)} km from ${nearest.d.slug} (radius ${(nearest.d.radiusM / 1000).toFixed(1)} km). Retrieval never queries there, so no link and no curation can reach it.`,
      );
    }
    if (exact.length > 1) {
      line(
        `                      ⚠ ${exact.length} rows share this exact name — duplicate identities, a separate pool defect`,
      );
    }
  }

  head("would LINKING alone make them electable?");
  /**
   * The ticket's own question, and it is answerable from the scoring function
   * rather than from opinion. `freshness` is the ONLY term that changes when
   * a link is minted, and it is weighted 0.1:
   *
   *     unlinked            0.4 × 0.1 = 0.040
   *     linked              0.6 × 0.1 = 0.060
   *     details-fetched     1.0 × 0.1 = 0.100
   *
   * So a link is worth **+0.020** of score — against a jitter bound of
   * ±0.04, i.e. a pairwise swing of up to 0.08. The link is worth a quarter
   * of the noise it competes with.
   *
   * And that is not the whole of it. At SHORTLIST time no venue has been
   * fetched, so `rating` and `userRatingCount` are null for every candidate:
   * `ratingQuality` is the 0.35 prior for all of them and `lensFit` reads
   * fame = 0 for all of them. `personaAffinity` is per-CATEGORY, so it is
   * identical across every shopping venue. `priceFit` is 0.5 without a
   * price fact, which pool rows do not carry.
   *
   * **Within one category, at shortlist time, the only terms that differ are
   * freshness and jitter.** Eaton Centre is not losing to better venues; it
   * is losing a weighted coin flip against thousands of them.
   */
  const shopping = await (async () => {
    const PAGE = 1000;
    let from = 0;
    const out: { linked: number; total: number } = { linked: 0, total: 0 };
    for (;;) {
      const { data, error } = await client
        .from("places")
        .select("google_place_id, facts!inner(fact_key, value)")
        .eq("city", "toronto")
        .eq("facts.fact_key", "categories")
        .filter("facts.value->mapped", "cs", JSON.stringify(["shopping"]))
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as { google_place_id: string | null }[];
      for (const r of rows) {
        out.total++;
        if (r.google_place_id !== null) out.linked++;
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return out;
  })();
  line(
    `  pooled shopping venues: ${shopping.total} · already linked: ${shopping.linked} (${((shopping.linked / shopping.total) * 100).toFixed(1)}%)`,
  );
  line();
  line("  a link is worth +0.020 of score (freshness 0.4 → 0.6, weight 0.1).");
  line("  the jitter bound is ±0.04, a pairwise swing of 0.08.");
  line(
    `  so a linked mall outranks an unlinked venue only when their jitter draws differ by less than 0.02 —`,
  );
  line(
    `  and it must beat ${shopping.linked - 1} other ALREADY-LINKED shopping venues on jitter alone.`,
  );

  head("what curation would add, and the hole in it");
  const curatedKeys = Object.keys(FOUNDER_ANCHOR_WORTHY);
  line(`  FOUNDER_ANCHOR_WORTHY has entries for: ${curatedKeys.join(", ")}`);
  const missing = PLACE_CATEGORIES.filter((c) => !curatedKeys.includes(c));
  line(`  it has NONE for: ${missing.join(", ")}`);
  line();
  line("  `shopping` and `scenic_viewpoints` joined the vocabulary at XXX-37");
  line("  (Session 13). The curated list predates them and was never widened —");
  line("  the vocabulary-widening failure, in the highest-trust signal we have.");
  line();
  line("  Consequence, exactly: `anchorCalibre` gives a shopping venue tier-1");
  line("  worthiness ONLY by name-match, and there are no names to match. It");
  line("  therefore falls to the rating-count bar, which needs a Details fetch,");
  line("  which needs the shortlist — the coin flip above. Circular.");

  head("the shortlist, measured — is a named mall reachable today?");
  const persona = GOLDEN_PERSONAS["persona-shopper"]!;
  const seed = 42;
  const date = "2026-08-29";
  const request: GenerationRequest = {
    city: "toronto",
    date,
    persona,
    budgetBand: null,
    transport: ["walk", "transit"],
    seed,
  };
  const skeleton = buildSkeleton(request, { seed });
  const identity = personaIdentity(persona);
  const zones = zonesFor(
    persona.lens,
    [],
    diceStream({ seed, identity, site: "zone", context: date }),
  );
  const pool = await retrieveCandidates(
    client,
    "toronto",
    [...PLACE_CATEGORIES],
    zones,
    (category) =>
      diceIndex(
        { seed, identity, site: "pool-window", context: category },
        POOL_WINDOWS.length,
      ),
  );
  const scored = scoreAll(pool, persona, null, seed);
  const shortlist = pickShortlist(scored, skeleton);
  const namedInPool = (c: Candidate) =>
    NAMED.some(
      (n) =>
        n.kind === "venue" &&
        normalizeName(c.place.name) === normalizeName(n.poolSpelling ?? n.said),
    );
  const shoppingScored = scored.filter((c) => c.category === "shopping");
  line(
    `  persona-shopper, seed 42: ${shoppingScored.length} shopping candidates retrieved, ${shortlist.filter((c) => c.category === "shopping").length} shortlisted`,
  );
  const found = shoppingScored.filter(namedInPool);
  line(
    found.length === 0
      ? "  NONE of the founder's named malls is even in this day's retrieval window."
      : `  named malls retrieved: ${found.map((c) => `${c.place.name} (rank ${shoppingScored.indexOf(c) + 1}/${shoppingScored.length})`).join(", ")}`,
  );
  line(
    `  shortlisted named malls: ${shortlist.filter(namedInPool).map((c) => c.place.name).join(", ") || "none"}`,
  );
  head("the pool-window lottery, for the one mall that IS reachable");
  /**
   * `retrieveCandidates` caps each category at 400 rows and rotates through
   * eight stable orderings — labelled honestly at its own definition as
   * ROTATION, not coverage. With 3,423 pooled shopping venues, one district's
   * query returns roughly 350, and which 350 depends on the seed.
   *
   * So "is Eaton Centre retrievable" is not one question. It is eight.
   */
  const downtown = districtBySlug("downtown_core")!;
  const windows: string[] = [];
  for (let w = 0; w < POOL_WINDOWS.length; w += 1) {
    const rows = await retrieveCandidates(client, "toronto", ["shopping"], [downtown], () => w);
    windows.push(
      rows.some((r) => r.place.name === "CF Toronto Eaton Centre") ? "✓" : "·",
    );
  }
  line(
    `  CF Toronto Eaton Centre appears in ${windows.filter((x) => x === "✓").length} of ${POOL_WINDOWS.length} pool windows:  ${windows.join(" ")}`,
  );
  line(
    "  So even the reachable mall is a coin flip BEFORE the scoring coin flip.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
