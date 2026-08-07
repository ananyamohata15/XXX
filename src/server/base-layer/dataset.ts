/**
 * Pinned FSQ OS Places release (decision 002 + its Channel Addendum).
 * Channel: Hugging Face parquet (the S3 channel was sunset by Foursquare;
 * the Places Portal was DECLINED on its terms — see the addendum). Access
 * needs HF_TOKEN (gate accepted by the founder); the release stays pinned
 * by date and recorded on every row's provenance (source_version).
 * fetched_at for base-layer rows is the dataset PUBLICATION date, not the
 * ingestion date (Checkpoint 1 ruling 5) — ingestion time lives in traces.
 */

export const DATASET_VERSION = "dt=2026-07-09";
export const PUBLICATION_DATE_ISO = "2026-07-09T00:00:00.000Z";

const HF_DATASET_ROOT = "hf://datasets/foursquare/fsq-os-places";

export const PLACES_PARQUET_GLOB = `${HF_DATASET_ROOT}/release/${DATASET_VERSION}/places/parquet/*.parquet`;
export const CATEGORIES_PARQUET_GLOB = `${HF_DATASET_ROOT}/release/${DATASET_VERSION}/categories/parquet/*.parquet`;

/** One concrete file for the pushdown probe; size from the HF tree listing
 * (2026-08-05). Bytes received must be a small fraction of this or bulk
 * extraction stops before it starts. */
export const PUSHDOWN_PROBE_FILE = `${HF_DATASET_ROOT}/release/${DATASET_VERSION}/places/parquet/places_000000.parquet`;
export const PUSHDOWN_PROBE_FILE_SIZE_BYTES = 118_153_796;

export interface Bbox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** City of Toronto extents, hand-set (founder style, like Session 4 anchors). */
export const TORONTO_BBOX: Bbox = {
  latMin: 43.58,
  latMax: 43.86,
  lngMin: -79.64,
  lngMax: -79.11,
};

/** Kensington Market slice for the Step 3 dry run. */
export const KENSINGTON_BBOX: Bbox = {
  latMin: 43.65,
  latMax: 43.66,
  lngMin: -79.408,
  lngMax: -79.393,
};
