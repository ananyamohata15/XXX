/**
 * Request-time Google clients for the generation engine (CP1 §1.1 stages
 * 2–3). Everything a response contains is request-scoped in-memory
 * content (decision 001 ambiguity 2): it flows into `GrammarFact`s for
 * one generation and is never persisted, logged, or traced beyond call
 * counts and cost. The two exceptions are the two expressly-granted
 * storables: `id` (indefinite) and `location` (30-day regime, stored via
 * the existing discovery repo which owns that clock).
 *
 * Field masks are compliance artifacts (Session 4 law): adding a field is
 * a decision-doc event, not a code change. SKU tiers verified on the
 * pricing pages 2026-08-08: one Details call with this mask bills once at
 * the highest tier touched — Enterprise, $20.00/1,000 list, 1,000 free
 * events/month. Text Search (IDs Only) is $0 with an unlimited free cap.
 * `reservable` is Enterprise+Atmosphere ($25/1K) and deliberately NOT
 * requested (CP1 ruling 6).
 */

import { z } from "zod";
import { SEARCH_TEXT_URL } from "../discovery/fieldmask";

export const ENGINE_DETAILS_FIELD_MASK =
  "id,displayName,businessStatus,regularOpeningHours,priceLevel,priceRange,rating,userRatingCount,location";
export const PLACE_DETAILS_ENTERPRISE_USD_PER_CALL = 0.02;

export const LINK_SEARCH_FIELD_MASK = "places.id";
export const TEXT_SEARCH_IDS_ONLY_USD_PER_CALL = 0;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

/** Same retry law as every Google client in this repo (Session 4). */
export class EngineGoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EngineGoogleError";
  }
}

const timePointSchema = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

const moneySchema = z.object({
  currencyCode: z.string(),
  units: z.union([z.string(), z.number()]).optional(),
  nanos: z.number().optional(),
});

export const engineDetailsResponseSchema = z
  .object({
    id: z.string(),
    displayName: z.object({ text: z.string() }).partial().optional(),
    businessStatus: z.string().optional(),
    regularOpeningHours: z
      .object({
        periods: z
          .array(
            z.object({
              open: timePointSchema,
              close: timePointSchema.optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    priceLevel: z.string().optional(),
    priceRange: z
      .object({
        startPrice: moneySchema.optional(),
        endPrice: moneySchema.optional(),
      })
      .optional(),
    rating: z.number().optional(),
    userRatingCount: z.number().optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number() })
      .optional(),
  })
  // External responses are untrusted input, but unknown extra fields are
  // Google's to add — parse what we asked for, ignore the rest.
  .passthrough();
export type EngineDetailsResponse = z.infer<typeof engineDetailsResponseSchema>;

const linkSearchResponseSchema = z
  .object({
    places: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export interface EngineGoogleClient {
  getDetails(googlePlaceId: string): Promise<EngineDetailsResponse>;
  /** IDs-only text search; returns the top place id or null. Free tier. */
  searchPlaceId(
    textQuery: string,
    bias: { lat: number; lng: number; radiusM: number },
  ): Promise<string | null>;
}

export interface EngineGoogleClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function checkedJson(
  response: Response,
  label: string,
): Promise<unknown> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    const dailyQuota =
      detail.includes("RESOURCE_EXHAUSTED") &&
      (detail.includes("per day") || detail.includes("1/d/"));
    const retryable =
      (response.status === 429 && !dailyQuota) || response.status >= 500;
    throw new EngineGoogleError(
      `${label} HTTP ${response.status}: ${detail}`,
      response.status,
      retryable,
    );
  }
  return response.json();
}

export function createEngineGoogleClient(
  options: EngineGoogleClientOptions,
): EngineGoogleClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;

  async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
    for (let n = 1; ; n++) {
      try {
        return await attempt();
      } catch (err) {
        const retryable = err instanceof EngineGoogleError && err.retryable;
        if (!retryable || n >= MAX_ATTEMPTS) throw err;
        await sleep(BASE_BACKOFF_MS * 2 ** (n - 1) + Math.random() * 250);
      }
    }
  }

  return {
    getDetails(googlePlaceId) {
      return withRetry(async () => {
        const response = await fetchImpl(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`,
          {
            method: "GET",
            headers: {
              "X-Goog-Api-Key": options.apiKey,
              "X-Goog-FieldMask": ENGINE_DETAILS_FIELD_MASK,
            },
          },
        );
        return engineDetailsResponseSchema.parse(
          await checkedJson(response, "places.get(engine)"),
        );
      });
    },

    searchPlaceId(textQuery, bias) {
      return withRetry(async () => {
        const response = await fetchImpl(SEARCH_TEXT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": options.apiKey,
            "X-Goog-FieldMask": LINK_SEARCH_FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery,
            pageSize: 1,
            locationBias: {
              circle: {
                center: { latitude: bias.lat, longitude: bias.lng },
                radius: bias.radiusM,
              },
            },
          }),
        });
        const parsed = linkSearchResponseSchema.parse(
          await checkedJson(response, "places.searchText(ids-only)"),
        );
        return parsed.places?.[0]?.id ?? null;
      });
    },
  };
}
