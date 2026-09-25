import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, createProxyFetch } from "./proxy-fetch.js";

function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

/** A promise that only ever settles by rejecting when `signal` aborts — a provider that went silent. */
function hangUntilAborted<T>(signal: AbortSignal | null | undefined): Promise<T> {
  return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(abortError())));
}

describe("createProxyFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects with RequestTimeoutError when the provider never answers", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => hangUntilAborted(init.signal));
    const pending = createProxyFetch(1000)("http://provider.example/player_api.php");
    const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("keeps the deadline running while the body downloads", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, status: 200, text: () => hangUntilAborted(init.signal) }));
    const response = await createProxyFetch(1000)("http://provider.example/xmltv.php");
    const assertion = expect(response.text()).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("clears the deadline once the body has been read", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ hello: "world" }) });
    const response = await createProxyFetch(1000)("http://provider.example/player_api.php");
    await expect(response.json()).resolves.toEqual({ hello: "world" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards a caller's abort as a plain AbortError, not a timeout", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => hangUntilAborted(init.signal));
    const controller = new AbortController();
    const pending = createProxyFetch(1000)("http://provider.example/player_api.php", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
