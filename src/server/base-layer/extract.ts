import { readFile } from "node:fs/promises";
import {
  PLACES_PARQUET_GLOB,
  PUSHDOWN_PROBE_FILE,
  PUSHDOWN_PROBE_FILE_SIZE_BYTES,
  type Bbox,
} from "./dataset";

/**
 * DuckDB extraction over the pinned S3 release. Only scripts import this
 * module (it loads a native driver); everything downstream of the raw rows
 * is pure and lives in rows.ts.
 *
 * The import of @duckdb/node-api is dynamic so that merely importing this
 * file (e.g. for types) never loads the native binding.
 *
 * Bandwidth (Checkpoint 2 addition 2): measured as the delta of received
 * bytes across all interfaces from /proc/net/dev — an honest approximation
 * on an otherwise-idle machine, labeled as such in trace metadata rather
 * than dressed up as exact.
 */

export const BYTES_MEASUREMENT = "proc_net_dev_rx_delta_approx";

export async function readNetRxBytes(): Promise<number | null> {
  try {
    const raw = await readFile("/proc/net/dev", "utf8");
    let total = 0;
    for (const line of raw.split("\n").slice(2)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 1 && cols[0].endsWith(":")) {
        total += Number.parseInt(cols[1], 10) || 0;
      }
    }
    return total;
  } catch {
    return null;
  }
}

/**
 * Shared authenticated DuckDB connection for the HF parquet channel.
 * The token enters via the caller (from HF_TOKEN env, never from files),
 * lives in the secret-creation SQL in process memory, and never appears in
 * logs or errors — secret-creation failures are rethrown sanitized because
 * the driver's message could echo the SQL text.
 */
export async function connectFsq(hfToken: string) {
  if (hfToken.length === 0) throw new Error("empty HF token");
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run("install httpfs; load httpfs;");
  try {
    await connection.run(
      `create secret if not exists hf_gate (type huggingface, token '${hfToken.replace(/'/g, "''")}');`,
    );
  } catch {
    throw new Error(
      "huggingface secret creation failed (message withheld — it may echo the token)",
    );
  }
  return connection;
}

const EXTRACT_PROJECTION = `
  fsq_place_id,
  name,
  latitude,
  longitude,
  address,
  cast(to_json(fsq_category_ids) as varchar) as category_ids_json,
  cast(to_json(fsq_category_labels) as varchar) as category_labels_json,
  cast(date_closed as varchar) as date_closed,
  cast(to_json(unresolved_flags) as varchar) as unresolved_flags_json
`;

function bboxPredicate(bbox: Bbox): string {
  return `country = 'CA'
    and latitude between ${bbox.latMin} and ${bbox.latMax}
    and longitude between ${bbox.lngMin} and ${bbox.lngMax}`;
}

export interface ExtractResult {
  rows: unknown[];
  durationMs: number;
  bytesTransferredApprox: number | null;
}

export interface PushdownProbeResult {
  fileSizeBytes: number;
  rowsInFile: number;
  durationMs: number;
  bytesReceivedApprox: number | null;
  bytesMeasurement: string;
  /** bytesReceived / fileSize; the acceptance criterion is "small". */
  transferFraction: number | null;
}

/**
 * Prove remote predicate/projection pushdown against ONE parquet file
 * before any bulk transfer: a bbox count should move column chunks and the
 * footer, not the file. No writes anywhere.
 */
export async function probePushdown(
  hfToken: string,
  bbox: Bbox,
): Promise<PushdownProbeResult> {
  const before = await readNetRxBytes();
  const start = Date.now();
  const connection = await connectFsq(hfToken);
  const reader = await connection.runAndReadAll(
    `select count(*)::bigint as n
       from read_parquet('${PUSHDOWN_PROBE_FILE}')
      where ${bboxPredicate(bbox)}`,
  );
  const after = await readNetRxBytes();
  const bytes = before !== null && after !== null ? after - before : null;
  return {
    fileSizeBytes: PUSHDOWN_PROBE_FILE_SIZE_BYTES,
    rowsInFile: Number((reader.getRowObjects()[0] as { n: unknown }).n),
    durationMs: Date.now() - start,
    bytesReceivedApprox: bytes,
    bytesMeasurement: BYTES_MEASUREMENT,
    transferFraction:
      bytes !== null ? bytes / PUSHDOWN_PROBE_FILE_SIZE_BYTES : null,
  };
}

/** Count matching rows without pulling them (free probe for Checkpoint 3). */
export async function countTorontoRows(
  hfToken: string,
  bbox: Bbox,
): Promise<number> {
  const connection = await connectFsq(hfToken);
  const reader = await connection.runAndReadAll(
    `select count(*)::bigint as n
       from read_parquet('${PLACES_PARQUET_GLOB}')
      where ${bboxPredicate(bbox)}`,
  );
  const first = reader.getRowObjects()[0] as { n: unknown };
  return Number(first.n);
}

export async function extractRows(
  hfToken: string,
  bbox: Bbox,
): Promise<ExtractResult> {
  const before = await readNetRxBytes();
  const start = Date.now();
  const connection = await connectFsq(hfToken);
  const reader = await connection.runAndReadAll(
    `select ${EXTRACT_PROJECTION}
       from read_parquet('${PLACES_PARQUET_GLOB}')
      where ${bboxPredicate(bbox)}`,
  );
  // JSON-compatible values: BIGINT/DECIMAL arrive as strings, DOUBLE as
  // number — the Zod boundary in rows.ts is the arbiter of shape.
  const rows = reader.getRowObjectsJson() as unknown[];
  const after = await readNetRxBytes();
  return {
    rows,
    durationMs: Date.now() - start,
    bytesTransferredApprox:
      before !== null && after !== null ? after - before : null,
  };
}
