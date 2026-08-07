import { createClient } from "@supabase/supabase-js";
import { createInstrumentation } from "../src/server/instrumentation";
import {
  KENSINGTON_BBOX,
  PLACES_PARQUET_GLOB,
  TORONTO_BBOX,
  type Bbox,
} from "../src/server/base-layer/dataset";
import {
  BYTES_MEASUREMENT,
  countTorontoRows,
  extractRows,
  probePushdown,
} from "../src/server/base-layer/extract";
import { runBaseLayerIngest } from "../src/server/base-layer/ingest";

/**
 * Base-layer ingestion (decision 002). Spends no API money ($0 open data),
 * but writes to production and pulls bandwidth — every invocation prompts
 * (npx tsx ask rule).
 *
 * Modes (explicit, no default):
 *   --probe-pushdown                    bbox count against ONE remote parquet
 *                                       file, bytes-transferred reported;
 *                                       zero writes. Gate for bulk transfer.
 *   --count-only <toronto|kensington>   free row-count probe, zero writes
 *   --probe-kensington                  extract + write the Kensington slice
 *   --full                              extract + write the Toronto bbox
 *
 * Env: HF_TOKEN (HF gate credential — environment only, never read from
 * files, never logged), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function pickBbox(label: string): Bbox {
  if (label === "toronto") return TORONTO_BBOX;
  if (label === "kensington") return KENSINGTON_BBOX;
  console.error(`Unknown bbox label: ${label}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const countIndex = argv.indexOf("--count-only");
  const pushdown = argv.includes("--probe-pushdown");
  const probe = argv.includes("--probe-kensington");
  const full = argv.includes("--full");
  const modes = [countIndex >= 0, pushdown, probe, full].filter(Boolean).length;
  if (modes !== 1) {
    console.error(
      "Exactly one of --probe-pushdown, --count-only <bbox>, --probe-kensington, --full is required.",
    );
    process.exit(1);
  }

  const hfToken = requireEnv("HF_TOKEN");

  if (pushdown) {
    const result = await probePushdown(hfToken, TORONTO_BBOX);
    console.log(JSON.stringify({ mode: "probe-pushdown", ...result }, null, 2));
    return;
  }

  if (countIndex >= 0) {
    const label = argv[countIndex + 1];
    if (!label) {
      console.error("--count-only requires <toronto|kensington>.");
      process.exit(1);
    }
    const n = await countTorontoRows(hfToken, pickBbox(label));
    console.log(JSON.stringify({ mode: "count-only", bbox: label, rows: n }));
    return;
  }

  const bboxLabel = probe ? "kensington" : "toronto";
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log(
    JSON.stringify({ mode: probe ? "probe" : "full", bbox: bboxLabel }),
  );
  const extraction = await extractRows(hfToken, pickBbox(bboxLabel));
  console.log(
    JSON.stringify({
      rows_extracted: extraction.rows.length,
      duration_ms: extraction.durationMs,
      bytes_transferred_approx: extraction.bytesTransferredApprox,
    }),
  );

  const report = await runBaseLayerIngest({
    supabase,
    instrumentation: createInstrumentation(supabase),
    rawRows: extraction.rows,
    extraction: {
      source: PLACES_PARQUET_GLOB,
      bboxLabel,
      durationMs: extraction.durationMs,
      bytesTransferredApprox: extraction.bytesTransferredApprox,
      bytesMeasurement: BYTES_MEASUREMENT,
    },
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
