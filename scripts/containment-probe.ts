import { createClient } from "@supabase/supabase-js";
import { normalizeName } from "../src/shared/anchor-calibre";
import { haversineKm } from "../src/shared/day-grammar/travel";

/**
 * Container-vs-tenant probe (XXX-35, Session 13 Step 2, mining finding 2).
 *
 * The founder, on a day whose contrast card was a cheese counter seated for
 * 90 minutes:
 *
 *   *"Weird, its a shop in st lawerence, not worth 1hr 30 mins"* … *"Rather
 *   maybe the card should have been st Lawerence market, and in the
 *   description you should try olympic cheese + any other top reccos from st
 *   lawerence mkt"*
 *
 * A stall INSIDE a market is a distinct FSQ place from the market itself,
 * and nothing prefers the container. Dwell then follows the CATEGORY
 * (`markets.typical`), so one cheese counter inherits a market-hall dwell.
 *
 * Before building a detector, this asks whether the data can support one.
 * Session 12's brief proposed Session 5's `link_collision` pairs as the
 * containment evidence; there are **three** such rows in the whole city, two
 * of them the same district. That is not a corpus. So this measures the two
 * signals that might actually scale:
 *
 *   1. CO-LOCATION — a tenant sits at its container's coordinates.
 *   2. NAME CONTAINMENT — "Kensington Market Sourdough" contains its
 *      container's name. (Already proven hazardous for tier-1 curation; the
 *      question here is whether it is usable as a tier-3 advisory.)
 *
 * It reports what it finds and does not decide. A detector proposed without
 * this measurement would be exactly the speculative fix CLAUDE.md forbids.
 *
 * FREE and read-only: pool reads only. No Google, no Anthropic, no writes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/containment-probe.ts
 *   npx tsx --env-file=.env.local scripts/containment-probe.ts --metres 75
 */

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`══ ${s} ${"═".repeat(Math.max(0, 66 - s.length))}`);
};

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

interface Row {
  id: string;
  name: string;
  lat: number;
  lng: number;
  facts: { fact_key: string; value: { mapped?: string[] } }[];
}

async function main(): Promise<void> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const metres = Number(arg("--metres") ?? 60);

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("places")
      .select("id, name, lat, lng, facts(fact_key, value)")
      .eq("city", "toronto")
      .eq("source", "fsq_os_places")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`pool read: ${error.message}`);
    if (data === null || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  const categoriesOf = (r: Row): string[] =>
    r.facts?.find((f) => f.fact_key === "categories")?.value?.mapped ?? [];

  head(`POOL — ${rows.length} Toronto FSQ identities`);
  const containers = rows.filter((r) => categoriesOf(r).includes("markets"));
  line(`  places mapped to \`markets\` (candidate CONTAINERS): ${containers.length}`);
  line(`  co-location radius under test: ${metres} m`);

  /** Neighbours of each container, by straight-line distance. */
  const clusters: { container: Row; near: Row[] }[] = [];
  for (const container of containers) {
    const near = rows.filter(
      (r) =>
        r.id !== container.id &&
        haversineKm(
          { lat: container.lat, lng: container.lng },
          { lat: r.lat, lng: r.lng },
        ) *
          1000 <=
          metres,
    );
    if (near.length > 0) clusters.push({ container, near });
  }

  head("CO-LOCATION — containers with neighbours inside the radius");
  line(`  ${clusters.length} of ${containers.length} markets have any neighbour`);
  const sorted = [...clusters].sort((a, b) => b.near.length - a.near.length);
  for (const { container, near } of sorted.slice(0, 15)) {
    line();
    line(`  ${container.name}  — ${near.length} within ${metres}m`);
    for (const n of near.slice(0, 8)) {
      const d = Math.round(
        haversineKm(
          { lat: container.lat, lng: container.lng },
          { lat: n.lat, lng: n.lng },
        ) * 1000,
      );
      const cats = categoriesOf(n).join("/") || "(unmapped)";
      line(`      ${String(d).padStart(3)}m  ${n.name}  [${cats}]`);
    }
    if (near.length > 8) line(`      … and ${near.length - 8} more`);
  }

  head("NAME CONTAINMENT — a place whose name contains a container's name");
  let containmentHits = 0;
  for (const container of containers) {
    const cname = normalizeName(container.name);
    if (cname.split(" ").length < 2) continue; // one-word names over-match
    for (const r of rows) {
      if (r.id === container.id) continue;
      const rname = normalizeName(r.name);
      if (rname !== cname && rname.includes(cname)) {
        containmentHits += 1;
        if (containmentHits <= 20) {
          const d = Math.round(
            haversineKm(
              { lat: container.lat, lng: container.lng },
              { lat: r.lat, lng: r.lng },
            ) * 1000,
          );
          line(`  "${r.name}"  ⊃  "${container.name}"   (${d}m apart)`);
        }
      }
    }
  }
  line();
  line(`  total name-containment pairs: ${containmentHits}`);

  head("THE FOUNDER'S OWN CASE");
  for (const needle of ["olympic cheese", "st lawrence market", "st lawrence"]) {
    const hits = rows.filter((r) => normalizeName(r.name).includes(needle));
    line(`  "${needle}" → ${hits.length} identit(y/ies)`);
    for (const h of hits.slice(0, 6)) {
      line(
        `      ${h.name}  [${categoriesOf(h).join("/") || "(unmapped)"}]  ${h.lat.toFixed(5)},${h.lng.toFixed(5)}`,
      );
    }
  }
  line();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
