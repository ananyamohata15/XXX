import {
  placeDetailsResponseSchema,
  type PlaceDetailsResponse,
} from "./schemas";

/**
 * Place Details client for the request-scoped name confirmation (decision
 * 002 §3). Field mask is exactly id,displayName — Place Details Pro,
 * $17.00/1,000 list (pricing page 2026-07-31, fetched 2026-08-05).
 *
 * The returned displayName exists only in the caller's process memory for
 * the duration of one comparison. It must never reach the database, traces,
 * logs, or error text. Error bodies are Google error JSON (no place
 * content); they are truncated and safe to surface.
 *
 * Retry policy: same as the discovery client — 429/5xx backoff (3 attempts)
 * then loud abort; other 4xx abort immediately.
 */

export const CONFIRM_FIELD_MASK = "id,displayName";
export const PLACE_DETAILS_PRO_USD_PER_CALL = 0.017;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

export class DetailsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DetailsRequestError";
  }
}

export interface DetailsClient {
  getPlace(googlePlaceId: string): Promise<PlaceDetailsResponse>;
}

interface DetailsClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests so backoff is instant and assertable. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createDetailsClient(
  options: DetailsClientOptions,
): DetailsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;

  async function attemptOnce(
    googlePlaceId: string,
  ): Promise<PlaceDetailsResponse> {
    const response = await fetchImpl(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": options.apiKey,
          "X-Goog-FieldMask": CONFIRM_FIELD_MASK,
        },
      },
    );
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new DetailsRequestError(
        `places.get HTTP ${response.status}: ${detail}`,
        response.status,
        retryable,
      );
    }
    return placeDetailsResponseSchema.parse(await response.json());
  }

  return {
    async getPlace(googlePlaceId) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await attemptOnce(googlePlaceId);
        } catch (err) {
          const retryable =
            err instanceof DetailsRequestError && err.retryable;
          if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
          const jitter = Math.random() * 250;
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter);
        }
      }
    },
  };
}
