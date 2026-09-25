import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithConcurrency, withRetry } from "./retry.js";

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries with exponential backoff until it succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("1")).mockRejectedValueOnce(new Error("2")).mockResolvedValue("ok");
    const done = withRetry(fn, { retries: 2, baseDelayMs: 100 });

    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // first retry after 100ms
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); // second after a further 200ms
    await expect(done).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last retry with the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still down"));
    const done = withRetry(fn, { retries: 1, baseDelayMs: 10 });
    const assertion = expect(done).rejects.toThrow("still down");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry an error shouldRetry rejects", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("bad login"));
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 10, shouldRetry: () => false })).rejects.toThrow("bad login");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("runWithConcurrency", () => {
  it("never has more than the limit in flight, and runs everything", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(n);
      inFlight--;
    });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
