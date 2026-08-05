import type { RunCell } from "./plan";

/**
 * Field-mask construction for discovery (XXX-22). Pure — the compliance
 * artifact is testable without a network.
 *
 * The mask IS the ToS proof (decision doc 001): the two fields we may store
 * (place_id, lat/lng) are the only place fields we request. Adding a field
 * here is a compliance decision, not a code change — it must go back through
 * a decision doc.
 */

export const DISCOVERY_FIELD_MASK = "places.id,places.location,nextPageToken";

/**
 * Text Search Pro, USD list price per request (≤100K monthly tier), from
 * https://developers.google.com/maps/billing-and-pricing/pricing as of
 * 2026-08-05. Instrumentation records list price always; free-tier
 * allowances are a billing offset, not a cost of zero (Checkpoint 2 ruling).
 */
export const TEXT_SEARCH_PRO_USD_PER_CALL = 0.032;

export const SEARCH_TEXT_URL =
  "https://places.googleapis.com/v1/places:searchText";

export interface SearchTextRequest {
  url: string;
  /** Verbatim X-Goog-FieldMask header value — logged as the compliance artifact. */
  fieldMask: string;
  body: {
    textQuery: string;
    pageSize: number;
    locationBias: RunCell["locationBias"];
    pageToken?: string;
  };
}

export function buildSearchTextRequest(
  cell: RunCell,
  pageToken?: string,
): SearchTextRequest {
  return {
    url: SEARCH_TEXT_URL,
    fieldMask: DISCOVERY_FIELD_MASK,
    body: {
      textQuery: cell.textQuery,
      pageSize: 20,
      locationBias: cell.locationBias,
      ...(pageToken !== undefined ? { pageToken } : {}),
    },
  };
}
