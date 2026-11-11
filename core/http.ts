// Retries for free public endpoints, which time out and rate-limit. Works in Node and browsers.

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Statuses worth retrying: timeouts, rate limits and server errors. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** HTTP 429. Waits are longer than for other errors, and follow the server's Retry-After when it sends one. */
export class RateLimited extends Error {
  readonly retryAfterMs: number | undefined;
  constructor(retryAfter: string | null) {
    super('HTTP 429 (rate limited)');
    this.name = 'RateLimited';
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    this.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : undefined;
  }
}

/** Throws the right retryable error for a response that should be retried; does nothing otherwise. */
export function throwIfRetryable(res: Response): void {
  if (res.status === 429) throw new RateLimited(res.headers.get('retry-after'));
  if (isRetryableStatus(res.status)) throw new Error(`HTTP ${res.status}`);
}

/**
 * Runs `attempt` until it succeeds, waiting delayMs, 2·delayMs, 4·delayMs... between tries
 * (three times longer after a 429, or as long as its Retry-After says).
 * An error for which `isFinal` returns true is thrown at once (for example "unknown account").
 */
export async function withRetries<T>(
  label: string,
  attempts: number,
  attempt: () => Promise<T>,
  isFinal: (error: unknown) => boolean,
  delayMs = 400,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (isFinal(error)) throw error;
      last = error;
      if (i < attempts) {
        const wait = delayMs * 2 ** (i - 1);
        await sleep(error instanceof RateLimited ? Math.max(wait * 3, error.retryAfterMs ?? 0) : wait);
      }
    }
  }
  throw new Error(`${label}: failed after ${attempts} attempts: ${String(last)}`);
}

/** An answer that retrying won't change: a 4xx from an HTTP API, or an error from the chain. */
export class FinalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinalError';
  }
}
