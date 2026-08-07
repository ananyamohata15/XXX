import { checkHealth } from "../src/server/health";

/**
 * Runs the health check exactly as /api/health serves it (same code path)
 * and exits 0/1 mirroring 200/503. Exists because the updated check only
 * serves from production after the next merge; this is the live-evidence
 * path until then (Session 6 Step 2).
 *
 * Usage: npx tsx --env-file <env> scripts/health-report.ts
 */
async function main() {
  const report = await checkHealth();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === "healthy" ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
