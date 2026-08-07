import { z } from "zod";
import { citySchema } from "../domain/schemas";

/**
 * Zod boundary for the base layer (decision 002). Parquet rows are untrusted
 * input like any API response: parse, don't validate-and-hope.
 */

/** One raw row off the FSQ places parquet (post-SQL-projection). */
export const fsqExtractRowSchema = z.object({
  fsq_place_id: z.string().min(1),
  name: z.string().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  address: z.string().nullable(),
  /** JSON-encoded string arrays (cast in SQL for driver-type stability). */
  category_labels_json: z.string().nullable(),
  category_ids_json: z.string().nullable(),
  date_closed: z.string().nullable(),
  unresolved_flags_json: z.string().nullable(),
});
export type FsqExtractRow = z.infer<typeof fsqExtractRowSchema>;

/** Write-boundary shape for one base-layer identity. The repo pins
 * source='fsq_os_places' and tier=2 itself — callers cannot claim otherwise
 * (same pattern as createSlot pinning reason_tier=3). */
export const newBaseLayerPlaceSchema = z.strictObject({
  city: citySchema,
  fsqPlaceId: z.string().min(1),
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** null = not published in the dataset (honest absence). */
  address: z.string().min(1).nullable(),
  datasetVersion: z.string().regex(/^dt=\d{4}-\d{2}-\d{2}$/),
  /** Dataset publication date — becomes fetched_at (Checkpoint 1 ruling 5). */
  publicationDate: z.iso.datetime({ offset: true }),
});
export type NewBaseLayerPlace = z.infer<typeof newBaseLayerPlaceSchema>;

/** Place Details response under the id,displayName mask. displayName is
 * request-scoped Google content: compared in memory, never persisted. */
export const placeDetailsResponseSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string().min(1) }).optional(),
});
export type PlaceDetailsResponse = z.infer<typeof placeDetailsResponseSchema>;

export const MATCH_STATUSES = [
  "matched_confirmed",
  "matched_unconfirmed",
  "ambiguous",
  "name_mismatch",
  "no_candidates",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Write-boundary shape for one matching outcome. Deliberately has NO field
 * that could carry a name — the matcher structurally cannot persist one. */
export const newIdentityMatchSchema = z
  .strictObject({
    discoveredPlaceId: z.uuid(),
    status: z.enum(MATCH_STATUSES),
    placeId: z.uuid().nullable(),
    bestScore: z.number().min(0).max(1).nullable(),
    method: z.string().min(1).nullable(),
    candidates: z
      .strictObject({
        entries: z.array(
          z.strictObject({
            place_id: z.uuid(),
            score: z.number().min(0).max(1),
          }),
        ),
        note: z.enum(["mid_band", "low_margin", "link_collision"]).optional(),
      })
      .nullable(),
    matchedAt: z.iso.datetime({ offset: true }),
    traceId: z.uuid(),
  })
  .superRefine((m, ctx) => {
    // Mirror of identity_matches_status_shape — the DB wins arguments, but
    // the boundary refuses the same shapes first.
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    switch (m.status) {
      case "matched_confirmed":
        if (m.placeId === null || m.bestScore === null || m.method === null)
          bad("matched_confirmed requires placeId, bestScore, method");
        break;
      case "matched_unconfirmed":
        if (m.placeId === null) bad("matched_unconfirmed requires placeId");
        if (m.bestScore !== null || m.method !== null || m.candidates !== null)
          bad("matched_unconfirmed carries no score/method/candidates");
        break;
      case "ambiguous":
      case "name_mismatch":
        if (m.placeId !== null) bad(`${m.status} must not carry placeId`);
        if (m.bestScore === null || m.method === null)
          bad(`${m.status} requires bestScore and method`);
        break;
      case "no_candidates":
        if (
          m.placeId !== null ||
          m.bestScore !== null ||
          m.method !== null ||
          m.candidates !== null
        )
          bad("no_candidates carries no link, score, method, or candidates");
        break;
    }
  });
export type NewIdentityMatch = z.infer<typeof newIdentityMatchSchema>;
