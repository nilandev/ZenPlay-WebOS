/** Default deadline for ordinary provider API calls (auth, categories, single-item info) — long enough for a slow panel, short enough that a dead one surfaces as an error instead of an endless shimmer. */
export const API_TIMEOUT_MS = 15_000;

/** Deadline for the big payloads — full live/VOD/series lists, XMLTV guides, M3U files — which can legitimately take a minute or more on a slow connection. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Thrown when a provider request (including reading its body) doesn't finish within its deadline — see createProxyFetch. */
export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The provider didn't respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "RequestTimeoutError";
  }
}

export function isTimeoutError(err: unknown): err is RequestTimeoutError {
  return err instanceof RequestTimeoutError;
}

/**
 * Routes cross-origin IPTV provider requests through the dev-only same-origin
 * proxy (see vite-dev-proxy.ts) when running under `vite dev`, so the
 * browser's CORS check never sees a cross-origin request in the first place.
 *
 * In production builds (`import.meta.env.DEV` is false), this is a plain
 * passthrough to `fetch` — the webOS TV runtime doesn't need it and
 * shipping the proxy there would be pointless (there's no dev server to
 * proxy through).
 */
const routedFetch: typeof fetch = (input, init) => {
  if (!import.meta.env.DEV || input instanceof Request) {
    return fetch(input, init);
  }
  const url = input instanceof URL ? input.href : input;
  return fetch(`/__iptv-proxy?url=${encodeURIComponent(url)}`, init);
};

const BODY_READERS = ["json", "text", "arrayBuffer", "blob"] as const;

/**
 * A fetch with a hard deadline: aborts the request after `timeoutMs` and
 * rejects with RequestTimeoutError instead of hanging forever on a provider
 * that accepted the connection and then went silent (a real failure mode on
 * cheap IPTV panels, and one that left screens shimmering indefinitely).
 *
 * The deadline covers reading the body too, not just the headers — a
 * stalled 50MB XMLTV download is the more common hang — so the returned
 * Response's json/text/arrayBuffer/blob are wrapped to map an abort into
 * RequestTimeoutError and to clear the timer once the body is in. Mapping is
 * done by hand rather than via AbortController.abort(reason) because webOS's
 * older Chromium builds predate abort reasons and always reject with a bare
 * AbortError. A caller's own `init.signal` still works and is forwarded; its
 * aborts surface as the usual AbortError, not a timeout.
 */
export function createProxyFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const callerSignal = init?.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    const settle = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };
    const mapError = (err: unknown) => (timedOut ? new RequestTimeoutError(timeoutMs) : err);

    let response: Response;
    try {
      response = await routedFetch(input, { ...init, signal: controller.signal });
    } catch (err) {
      settle();
      throw mapError(err);
    }

    for (const method of BODY_READERS) {
      const original = response[method] as unknown;
      if (typeof original !== "function") continue;
      const read = (original as () => Promise<unknown>).bind(response);
      Object.defineProperty(response, method, {
        configurable: true,
        value: () =>
          read().then(
            (value) => {
              settle();
              return value;
            },
            (err: unknown) => {
              settle();
              throw mapError(err);
            },
          ),
      });
    }
    return response;
  };
}

/** Provider fetch for ordinary API calls — see API_TIMEOUT_MS. */
export const proxyFetch: typeof fetch = createProxyFetch(API_TIMEOUT_MS);

/** Provider fetch for full-catalog/guide/playlist downloads — see DOWNLOAD_TIMEOUT_MS. */
export const proxyDownloadFetch: typeof fetch = createProxyFetch(DOWNLOAD_TIMEOUT_MS);
