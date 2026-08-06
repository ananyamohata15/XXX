import type { PlaceCategory } from "../domain/schemas";
import { PLACE_CATEGORIES } from "../domain/schemas";
import {
  fsqExtractRowSchema,
  type FsqExtractRow,
  type NewBaseLayerPlace,
} from "./schemas";
import { DATASET_VERSION, PUBLICATION_DATE_ISO } from "./dataset";
import { CATEGORY_ID_MAP, GENERATED_FROM } from "./category-ids.generated";

/**
 * Pure row pipeline: raw parquet row → keep (with mapped categories) or drop
 * (with a counted reason). SESSION_NOTES 2.1 quality filter, in check order.
 * No I/O here — extract.ts feeds it, tests fixture it.
 */

export const DROP_REASONS = [
  "empty_name",
  "missing_coords",
  "date_closed",
  "flag_closed",
  "flag_doesnt_exist",
  "flag_delete",
  "flag_duplicate",
  "flag_privatevenue",
  "flag_inappropriate",
  "category_unmapped",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

const FLAG_REASONS: Record<string, DropReason> = {
  closed: "flag_closed",
  doesnt_exist: "flag_doesnt_exist",
  delete: "flag_delete",
  duplicate: "flag_duplicate",
  privatevenue: "flag_privatevenue",
  inappropriate: "flag_inappropriate",
};

export interface KeptRow {
  kept: true;
  place: NewBaseLayerPlace;
  mapped: PlaceCategory[];
  sourceLabels: string[];
}

export interface DroppedRow {
  kept: false;
  reason: DropReason;
  /** For category_unmapped: the top-level breadcrumb(s), for the report. */
  unmappedTopLevels?: string[];
}

function parseJsonStringArray(json: string | null): string[] {
  if (json === null) return [];
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    parsed.some((v) => typeof v !== "string")
  ) {
    throw new Error("expected a JSON array of strings from the extraction");
  }
  return parsed as string[];
}

/**
 * The production ID map, refusing to serve an unpinned or version-skewed
 * taxonomy. Tests inject fixture maps into classifyRow directly.
 */
export function pinnedCategoryIdMap(): Readonly<Record<string, PlaceCategory>> {
  if (GENERATED_FROM === null) {
    throw new Error(
      "category ID map is unpinned — run scripts/pin-categories.ts first",
    );
  }
  if (GENERATED_FROM !== DATASET_VERSION) {
    throw new Error(
      `category ID map pinned from ${GENERATED_FROM}, dataset is ${DATASET_VERSION} — re-pin first`,
    );
  }
  return CATEGORY_ID_MAP;
}

export function classifyRow(
  raw: unknown,
  idMap: Readonly<Record<string, PlaceCategory>>,
): KeptRow | DroppedRow {
  const row: FsqExtractRow = fsqExtractRowSchema.parse(raw);

  const name = row.name?.trim() ?? "";
  if (name.length === 0) return { kept: false, reason: "empty_name" };
  if (row.latitude === null || row.longitude === null)
    return { kept: false, reason: "missing_coords" };
  if (row.date_closed !== null) return { kept: false, reason: "date_closed" };

  for (const flag of parseJsonStringArray(row.unresolved_flags_json)) {
    const reason = FLAG_REASONS[flag];
    if (reason) return { kept: false, reason };
  }

  const ids = parseJsonStringArray(row.category_ids_json);
  const labels = parseJsonStringArray(row.category_labels_json);
  const mappedSet = new Set<PlaceCategory>();
  for (const id of ids) {
    const category = idMap[id];
    if (category) mappedSet.add(category);
  }
  if (mappedSet.size === 0) {
    return {
      kept: false,
      reason: "category_unmapped",
      unmappedTopLevels: [
        ...new Set(labels.map((l) => l.split(" > ")[0] ?? l)),
      ],
    };
  }
  // Stable order for fact values: declaration order of the vocabulary.
  const mapped = PLACE_CATEGORIES.filter((c) => mappedSet.has(c));

  const address = row.address?.trim() ?? "";
  return {
    kept: true,
    place: {
      city: "toronto",
      fsqPlaceId: row.fsq_place_id,
      name,
      lat: row.latitude,
      lng: row.longitude,
      address: address.length > 0 ? address : null,
      datasetVersion: DATASET_VERSION,
      publicationDate: PUBLICATION_DATE_ISO,
    },
    mapped,
    sourceLabels: labels,
  };
}
