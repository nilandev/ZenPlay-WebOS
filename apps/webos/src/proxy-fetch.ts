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
export const proxyFetch: typeof fetch = (input, init) => {
  if (!import.meta.env.DEV || input instanceof Request) {
    return fetch(input, init);
  }
  const url = input instanceof URL ? input.href : input;
  return fetch(`/__iptv-proxy?url=${encodeURIComponent(url)}`, init);
};
