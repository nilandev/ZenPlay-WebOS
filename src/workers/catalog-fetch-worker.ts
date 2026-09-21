/// <reference lib="webworker" />
import { mapSeriesEntry, mapVodStream, type XtreamSeriesRaw, type XtreamVodStreamRaw } from "@core";
import { proxyFetch } from "../proxy-fetch.js";

/**
 * Runs the large VOD/series player_api.php fetch + JSON parse + reshape
 * entirely off the main thread. VOD/series catalogs can run into the tens
 * of thousands of entries (10MB+ of JSON) — doing `await response.json()`
 * and the array .map() reshape on the main thread blocks it for the whole
 * duration on webOS's constrained WebKit, which is a real, measurable UI
 * freeze (remote input stops responding, animations stutter), not just a
 * network wait. See catalog-worker-client.ts for the main-thread side of
 * this postMessage protocol.
 *
 * Deliberately scoped to VOD/series only (not live channels, which are
 * small enough not to be worth the postMessage/structured-clone overhead,
 * and not EPG, which already has its own regex-generator parse strategy for
 * a different reason — see docs referenced in the architecture plan this
 * implements). Kept dependency-free (fetch only, same philosophy as
 * XtreamClient) and imports only the pure mapper functions from
 * xtream-mappers.ts, never XtreamClient itself, since a Worker has no DOM
 * and no reason to carry XtreamClient's request-dedupe/auth machinery,
 * which belongs to the main thread's screens.
 */

export interface CatalogWorkerCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export type CatalogWorkerAction = "get_vod_streams" | "get_series";

export interface CatalogWorkerRequest {
  id: string;
  credentials: CatalogWorkerCredentials;
  action: CatalogWorkerAction;
  categoryId?: string;
}

export type CatalogWorkerResponse =
  | { id: string; ok: true; data: unknown[] }
  | { id: string; ok: false; error: string };

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildApiUrl(credentials: CatalogWorkerCredentials, action: CatalogWorkerAction, categoryId?: string): string {
  const url = new URL(`${stripTrailingSlash(credentials.baseUrl)}/player_api.php`);
  url.searchParams.set("username", credentials.username);
  url.searchParams.set("password", credentials.password);
  url.searchParams.set("action", action);
  if (categoryId) url.searchParams.set("category_id", categoryId);
  return url.toString();
}

async function handleRequest(request: CatalogWorkerRequest): Promise<unknown[]> {
  const url = buildApiUrl(request.credentials, request.action, request.categoryId);
  // Must go through proxyFetch, not a bare fetch() — under `vite dev` a
  // direct cross-origin request to the provider fails the browser's CORS
  // check (the same reason XtreamClient itself never calls fetch directly —
  // see its doc comment), and inside a Worker that failure surfaces as a
  // silently-rejected/never-resolving promise rather than a visible error,
  // which is what made this look like an indefinite freeze with no shimmer
  // and no error state rather than a clean failure.
  const response = await proxyFetch(url);
  if (!response.ok) throw new Error(`Xtream request failed: HTTP ${response.status}`);

  if (request.action === "get_vod_streams") {
    const raw = (await response.json()) as XtreamVodStreamRaw[];
    return raw.map((s) => mapVodStream(request.credentials, s));
  }

  const raw = (await response.json()) as XtreamSeriesRaw[];
  return raw.map(mapSeriesEntry);
}

self.onmessage = async (event: MessageEvent<CatalogWorkerRequest>) => {
  const request = event.data;
  try {
    const data = await handleRequest(request);
    const response: CatalogWorkerResponse = { id: request.id, ok: true, data };
    self.postMessage(response);
  } catch (err) {
    const response: CatalogWorkerResponse = { id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(response);
  }
};
