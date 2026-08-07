import { z } from "zod";

/**
 * Zod boundary for the discovery pipeline (XXX-22). Google's response is
 * untrusted input: parse, don't validate-and-hope. Shapes we don't request
 * are stripped; shapes we do request must conform or the run fails loudly.
 */

/** One place from a searchText response under the discovery field mask. */
export const searchResultPlaceSchema = z.object({
  id: z.string().min(1),
  /** Optional: a hit may legitimately come back without a location. */
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
});
export type SearchResultPlace = z.infer<typeof searchResultPlaceSchema>;

export const searchTextResponseSchema = z.object({
  /** Absent entirely when a query matches nothing. */
  places: z.array(searchResultPlaceSchema).optional(),
  nextPageToken: z.string().min(1).optional(),
});
export type SearchTextResponse = z.infer<typeof searchTextResponseSchema>;

/** Write-boundary shape for one discovered place (repo parses before upsert). */
export const newDiscoveredPlaceSchema = z.strictObject({
  city: z.literal("toronto"),
  googlePlaceId: z.string().min(1),
  /** null = Google returned no location — honest absence, row still lands. */
  coords: z
    .strictObject({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .nullable(),
  /** Response receipt time; starts the 30-day retention clock. */
  fetchedAt: z.iso.datetime({ offset: true }),
});
export type NewDiscoveredPlace = z.infer<typeof newDiscoveredPlaceSchema>;

export const newDiscoveryHitSchema = z.strictObject({
  discoveredPlaceId: z.uuid(),
  category: z.string().min(1),
  anchor: z.string().min(1),
  resultRank: z.number().int().min(1),
  traceId: z.uuid(),
  discoveredAt: z.iso.datetime({ offset: true }),
});
export type NewDiscoveryHit = z.infer<typeof newDiscoveryHitSchema>;
