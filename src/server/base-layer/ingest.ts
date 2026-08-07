import type { SupabaseClient } from "@supabase/supabase-js";
import type { Instrumentation } from "../instrumentation";
import { classifyRow, pinnedCategoryIdMap, type DropReason } from "./rows";
import { upsertBaseLayerPlace, upsertCategoriesFact } from "./repo";
import { DATASET_VERSION } from "./dataset";

/**
 * Base-layer ingestion orchestration (decision 002). Takes already-extracted
 * raw rows (extract.ts owns the DuckDB/S3 side) so the whole write path is
 * testable against a fake client. Open data: est_cost_usd 0 = known-free.
 */

export interface IngestReport {
  traceId: string;
  datasetVersion: string;
  rowsIn: number;
  kept: number;
  newPlaces: number;
  updatedPlaces: number;
  dropsByReason: Record<DropReason, number>;
  unmappedTopLevels: Record<string, number>;
  startedAt: string;
  finishedAt: string;
}

export async function runBaseLayerIngest(options: {
  supabase: SupabaseClient;
  instrumentation: Instrumentation;
  rawRows: unknown[];
  /** Extraction context recorded on the trace (bytes are Checkpoint 2 addition 2). */
  extraction: {
    source: string;
    bboxLabel: string;
    durationMs: number;
    bytesTransferredApprox: number | null;
    bytesMeasurement: string;
  };
  now?: () => Date;
}): Promise<IngestReport> {
  const { supabase, instrumentation, rawRows, extraction } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const traceId = await instrumentation.startTrace("base_layer_ingest");

  const dropsByReason = {} as Record<DropReason, number>;
  const unmappedTopLevels: Record<string, number> = {};
  let kept = 0;
  let newPlaces = 0;
  let updatedPlaces = 0;

  try {
    await instrumentation.logEvent(traceId, {
      provider: "fsq_os_places",
      endpoint: "s3.parquet_extract",
      estCostUsd: 0,
      durationMs: extraction.durationMs,
      metadata: {
        source: extraction.source,
        bbox: extraction.bboxLabel,
        dataset_version: DATASET_VERSION,
        rows_extracted: rawRows.length,
        bytes_transferred_approx: extraction.bytesTransferredApprox,
        bytes_measurement: extraction.bytesMeasurement,
      },
    });

    const writeStart = now().getTime();
    const idMap = pinnedCategoryIdMap();
    for (const raw of rawRows) {
      const outcome = classifyRow(raw, idMap);
      if (!outcome.kept) {
        dropsByReason[outcome.reason] =
          (dropsByReason[outcome.reason] ?? 0) + 1;
        for (const top of outcome.unmappedTopLevels ?? []) {
          unmappedTopLevels[top] = (unmappedTopLevels[top] ?? 0) + 1;
        }
        continue;
      }
      const { row, isNew } = await upsertBaseLayerPlace(supabase, outcome.place);
      if (isNew) newPlaces++;
      else updatedPlaces++;
      await upsertCategoriesFact(supabase, {
        placeId: row.id,
        mapped: outcome.mapped,
        sourceLabels: outcome.sourceLabels,
        publicationDate: outcome.place.publicationDate,
      });
      kept++;
    }

    await instrumentation.logEvent(traceId, {
      provider: "supabase",
      endpoint: "places.base_layer_upsert",
      estCostUsd: 0,
      durationMs: now().getTime() - writeStart,
      metadata: {
        kept,
        new_places: newPlaces,
        updated_places: updatedPlaces,
        drops_by_reason: dropsByReason,
      },
    });
  } catch (err) {
    await instrumentation.endTrace(traceId, {
      totalCostUsd: 0,
      metadata: {
        outcome: "aborted",
        error: err instanceof Error ? err.message : String(err),
        dataset_version: DATASET_VERSION,
        rows_in: rawRows.length,
        kept,
      },
    });
    throw err;
  }

  const finishedAt = now().toISOString();
  await instrumentation.endTrace(traceId, {
    totalCostUsd: 0,
    metadata: {
      outcome: "completed",
      dataset_version: DATASET_VERSION,
      rows_in: rawRows.length,
      kept,
      new_places: newPlaces,
      updated_places: updatedPlaces,
      drops_by_reason: dropsByReason,
      unmapped_top_levels: unmappedTopLevels,
      bytes_transferred_approx: extraction.bytesTransferredApprox,
      bytes_measurement: extraction.bytesMeasurement,
    },
  });

  return {
    traceId,
    datasetVersion: DATASET_VERSION,
    rowsIn: rawRows.length,
    kept,
    newPlaces,
    updatedPlaces,
    dropsByReason,
    unmappedTopLevels,
    startedAt,
    finishedAt,
  };
}
