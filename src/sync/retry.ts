export interface RetryOptions {
  /** Extra attempts after the first. */
  retries?: number;
  /** Delay before the first retry; doubles each time. */
  baseDelayMs?: number;
  /** Return false for errors that won't change on a retry (a rejected login, an empty guide). */
  shouldRetry?: (err: unknown) => boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a background task with exponential backoff. Only for work nobody
 * is watching (sync stages) — a screen's own fetch should fail fast and show
 * its error state instead of spinning silently through retries.
 */
export async function withRetry<T>(fn: () => Promise<T>, { retries = 2, baseDelayMs = 1000, shouldRetry = () => true }: RetryOptions = {}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) break;
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/** Bounded-concurrency runner: at most `concurrency` of `worker` in flight at once. */
export async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}
