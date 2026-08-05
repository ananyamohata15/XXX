import type { SupabaseClient } from "@supabase/supabase-js";
import type { Instrumentation } from "../instrumentation";
import type { PlacesClient } from "./client";
import {
  buildSearchTextRequest,
  DISCOVERY_FIELD_MASK,
  TEXT_SEARCH_PRO_USD_PER_CALL,
} from "./fieldmask";
import type { RunCell } from "./plan";
import { recordDiscoveryHit, upsertDiscoveredPlace } from "./repo";

/**
 * Discovery run orchestration (XXX-22). Cells run sequentially — 63 calls
 * do not need concurrency, and a serial run keeps rate-limit behavior and
 * the trace timeline trivially readable.
 *
 * Every API call logs a trace event with the LIST price (Checkpoint 2
 * ruling: free-tier allowance is a billing offset, not a cost of zero; the
 * allowance context lives in trace metadata, not in est_cost_usd).
 */

export interface CellReport {
  category: string;
  anchor: string;
  requests: number;
  resultsReturned: number;
  newPlaces: number;
  absentCoords: number;
}

export interface DiscoveryReport {
  traceId: string;
  fieldMask: string;
  cells: CellReport[];
  totalRequests: number;
  totalEstCostUsd: number;
  distinctPlaces: number;
  newPlaces: number;
  startedAt: string;
  finishedAt: string;
}

export interface RunDiscoveryOptions {
  supabase: SupabaseClient;
  places: PlacesClient;
  instrumentation: Instrumentation;
  plan: RunCell[];
  /** Injected in tests; defaults to wall clock. */
  now?: () => Date;
}

const FREE_TIER_NOTE =
  "est_cost_usd is Text Search Pro list price; Pro tier includes 5,000 free events/month (billing offset, not zero cost)";

export async function runDiscovery(
  options: RunDiscoveryOptions,
): Promise<DiscoveryReport> {
  const { supabase, places, instrumentation, plan } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const traceId = await instrumentation.startTrace("places_discovery");
  const seenThisRun = new Set<string>();
  const cells: CellReport[] = [];
  let totalRequests = 0;
  let newPlaces = 0;

  try {
    for (const cell of plan) {
      const request = buildSearchTextRequest(cell);
      const callStart = now().getTime();
      const response = await places.searchText(request);
      const durationMs = now().getTime() - callStart;
      const fetchedAt = now().toISOString();
      totalRequests++;

      const results = response.places ?? [];
      const report: CellReport = {
        category: cell.category,
        anchor: cell.anchor,
        requests: 1,
        resultsReturned: results.length,
        newPlaces: 0,
        absentCoords: 0,
      };

      for (const [index, result] of results.entries()) {
        const { row, isNew } = await upsertDiscoveredPlace(supabase, {
          city: "toronto",
          googlePlaceId: result.id,
          coords: result.location
            ? { lat: result.location.latitude, lng: result.location.longitude }
            : null,
          fetchedAt,
        });
        if (!result.location) report.absentCoords++;
        if (isNew && !seenThisRun.has(row.google_place_id)) {
          report.newPlaces++;
          newPlaces++;
        }
        seenThisRun.add(row.google_place_id);
        await recordDiscoveryHit(supabase, {
          discoveredPlaceId: row.id,
          category: cell.category,
          anchor: cell.anchor,
          resultRank: index + 1,
          traceId,
          discoveredAt: fetchedAt,
        });
      }

      await instrumentation.logEvent(traceId, {
        provider: "google_places",
        endpoint: "places.searchText",
        estCostUsd: TEXT_SEARCH_PRO_USD_PER_CALL,
        durationMs,
        metadata: {
          category: cell.category,
          anchor: cell.anchor,
          page: 1,
          field_mask: request.fieldMask,
          results_returned: report.resultsReturned,
          new_places: report.newPlaces,
          pricing_basis: "list",
        },
      });
      cells.push(report);
    }
  } catch (err) {
    // Fail loudly, but leave an honest trace of how far the run got.
    await instrumentation.endTrace(traceId, {
      totalCostUsd: totalRequests * TEXT_SEARCH_PRO_USD_PER_CALL,
      metadata: {
        outcome: "aborted",
        error: err instanceof Error ? err.message : String(err),
        requests: totalRequests,
        cells_completed: cells.length,
        cells_planned: plan.length,
        free_tier_note: FREE_TIER_NOTE,
      },
    });
    throw err;
  }

  const finishedAt = now().toISOString();
  const totalEstCostUsd = totalRequests * TEXT_SEARCH_PRO_USD_PER_CALL;
  await instrumentation.endTrace(traceId, {
    totalCostUsd: totalEstCostUsd,
    metadata: {
      outcome: "completed",
      field_mask: DISCOVERY_FIELD_MASK,
      requests: totalRequests,
      cells_completed: cells.length,
      distinct_places: seenThisRun.size,
      new_places: newPlaces,
      pricing_basis: "list",
      free_tier_note: FREE_TIER_NOTE,
    },
  });

  return {
    traceId,
    fieldMask: DISCOVERY_FIELD_MASK,
    cells,
    totalRequests,
    totalEstCostUsd,
    distinctPlaces: seenThisRun.size,
    newPlaces,
    startedAt,
    finishedAt,
  };
}
