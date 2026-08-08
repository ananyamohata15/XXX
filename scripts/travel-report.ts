import { createClient } from "@supabase/supabase-js";

/** Read-only: prints every travel_times row (both sources side by side)
 * so CHECKPOINT 3 can compare engine vs founder and see the doc-003
 * retention fields (source/tier/license/fetched_at) on landed rows. */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("travel_times")
    .select(
      "origin_label, dest_label, mode, duration_minutes, distance_km, source, tier, license, fetched_at",
    )
    .eq("city", "toronto")
    .order("origin_label")
    .order("dest_label")
    .order("mode")
    .order("source");
  if (error) throw new Error(error.message);
  console.log(`rows: ${data.length}`);
  for (const r of data) {
    console.log(
      [
        `${r.origin_label} → ${r.dest_label}`.padEnd(62),
        r.mode.padEnd(8),
        String(r.duration_minutes).padStart(3) + "m",
        (r.distance_km === null ? "  —  " : `${r.distance_km.toFixed(1)}km`).padStart(7),
        ` ${r.source}/${r.tier}`.padEnd(20),
        String(r.license ?? "—").padEnd(14),
        r.fetched_at,
      ].join(" "),
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
