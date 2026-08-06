import type { PlaceCategory } from "../domain/schemas";

/**
 * GENERATED FILE — written by scripts/pin-categories.ts from the pinned FSQ
 * release's categories table. Do not edit by hand; re-run the pin script.
 *
 * GENERATED_FROM null means the pin has not run yet — ingestion refuses to
 * start against an unpinned taxonomy (rows.ts throws).
 */

export const GENERATED_FROM: string | null = null;

export const CATEGORY_ID_MAP: Readonly<Record<string, PlaceCategory>> = {};

export const MATCHED_LABELS: Readonly<
  Partial<Record<PlaceCategory, readonly string[]>>
> = {};
