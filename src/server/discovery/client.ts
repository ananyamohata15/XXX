import {
  searchTextResponseSchema,
  type SearchTextResponse,
} from "./schemas";
import type { SearchTextRequest } from "./fieldmask";

/**
 * Thin Google Places (New) HTTP client. The API key lives only in the
 * closure and the outgoing header — never in errors, logs, or return values.
 *
 * Retry policy (SESSION_NOTES Step 2.6): 429/5xx retry with exponential
 * backoff + jitter, at most MAX_ATTEMPTS total attempts, then abort loudly.
 * Other 4xx (bad request, auth) abort immediately — retrying can't fix them
 * and spinning against a quota-shaped error is forbidden.
 */

export const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;

export class PlacesRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PlacesRequestError";
  }
}

export interface PlacesClient {
  searchText(request: SearchTextRequest): Promise<SearchTextResponse>;
}

interface PlacesClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests so backoff is instant and assertable. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createPlacesClient(options: PlacesClientOptions): PlacesClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;

  async function attemptOnce(
    request: SearchTextRequest,
  ): Promise<SearchTextResponse> {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": options.apiKey,
        "X-Goog-FieldMask": request.fieldMask,
      },
      body: JSON.stringify(request.body),
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      // Body may carry Google's error JSON; keep the message, never the key.
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new PlacesRequestError(
        `places.searchText HTTP ${response.status}: ${detail}`,
        response.status,
        retryable,
      );
    }
    return searchTextResponseSchema.parse(await response.json());
  }

  return {
    async searchText(request) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await attemptOnce(request);
        } catch (err) {
          const retryable =
            err instanceof PlacesRequestError && err.retryable;
          if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
          const jitter = Math.random() * 250;
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter);
        }
      }
    },
  };
}
