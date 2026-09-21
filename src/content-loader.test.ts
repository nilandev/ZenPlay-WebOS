import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XtreamCredentials } from "@core";
import { __resetRequestDedupeCacheForTests } from "./core/xtream/xtream-client.js";

const fetchCatalogMock = vi.fn();

// VOD/series fetches now go through the catalog Worker (see
// workers/catalog-worker-client.ts) rather than a direct fetch call — that
// protocol has its own dedicated test coverage in
// workers/catalog-worker-client.test.ts (with a mocked Worker global); here
// content-loader.ts's own responsibility (passing the right action/
// categoryId through, and staying on the direct XtreamClient path for live
// channels/M3U sources) is what's under test, so the worker client itself
// is mocked rather than exercised end-to-end.
vi.mock("./workers/catalog-worker-client.js", () => ({
  createCatalogWorkerClient: () => ({ fetchCatalog: fetchCatalogMock, terminate: vi.fn() }),
}));

const { loadChannelsByKind, loadSeriesList } = await import("./content-loader.js");

const xtreamSource: XtreamCredentials = {
  kind: "xtream",
  id: "source-1",
  name: "Test",
  baseUrl: "http://example.com",
  username: "user",
  password: "pass",
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

const AUTH_OK = jsonResponse({ user_info: { auth: 1, status: "Active", exp_date: null }, server_info: {} });

/** content-loader.ts routes Xtream calls through proxyFetch, which under Vitest's DEV-like import.meta.env wraps the real URL as a same-origin `/__iptv-proxy?url=<encoded>` request — decode it back to inspect the actual player_api.php query string. */
function realUrlFromCall(rawUrl: unknown): string {
  const url = String(rawUrl);
  const proxied = url.match(/^\/__iptv-proxy\?url=(.+)$/);
  return proxied ? decodeURIComponent(proxied[1]) : url;
}

describe("content-loader category passthrough", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetRequestDedupeCacheForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchCatalogMock.mockReset();
    fetchCatalogMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadChannelsByKind('movie', categoryId) passes categoryId through to the catalog worker's get_vod_streams action", async () => {
    fetchMock.mockResolvedValueOnce(AUTH_OK);

    await loadChannelsByKind(xtreamSource, "movie", "cat-42");

    expect(fetchCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "get_vod_streams", categoryId: "cat-42", credentials: xtreamSource }),
    );
  });

  it("loadChannelsByKind('movie') without a categoryId omits it from the worker request", async () => {
    fetchMock.mockResolvedValueOnce(AUTH_OK);

    await loadChannelsByKind(xtreamSource, "movie");

    expect(fetchCatalogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "get_vod_streams", categoryId: undefined }));
  });

  it("authenticates on the main thread before delegating to the worker, so a bad login surfaces before the worker call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));

    await expect(loadChannelsByKind(xtreamSource, "movie")).rejects.toThrow();
    expect(fetchCatalogMock).not.toHaveBeenCalled();
  });

  it("loadChannelsByKind('live', categoryId) passes category_id through to get_live_streams directly (not the worker)", async () => {
    fetchMock.mockResolvedValueOnce(AUTH_OK).mockResolvedValueOnce(jsonResponse([]));

    await loadChannelsByKind(xtreamSource, "live", "cat-7");

    const liveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("get_live_streams"));
    expect(realUrlFromCall(liveCall![0])).toContain("category_id=cat-7");
    expect(fetchCatalogMock).not.toHaveBeenCalled();
  });

  it("loadSeriesList(categoryId) passes categoryId through to the catalog worker's get_series action", async () => {
    fetchMock.mockResolvedValueOnce(AUTH_OK);

    await loadSeriesList(xtreamSource, "cat-9");

    expect(fetchCatalogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "get_series", categoryId: "cat-9" }));
  });

  it("returns an empty array for a non-Xtream source without touching fetch or the worker for series", async () => {
    const m3uSource = { kind: "m3u-file" as const, id: "m3u-1", name: "M3U", content: "" };
    const result = await loadSeriesList(m3uSource, "any-category");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchCatalogMock).not.toHaveBeenCalled();
  });

  it("filters an M3U source's channels by groupTitle when a categoryId is given", async () => {
    // "vod" in the group title is what parseM3u's detectKind recognizes as
    // a movie (see core/m3u/parse-m3u.ts) — keeps this test's fixture
    // unambiguous rather than depending on the URL-extension heuristic's
    // exact interaction with a trailing group-title.
    const m3uContent = [
      "#EXTM3U",
      '#EXTINF:-1 group-title="VOD Action",Movie A',
      "http://example.com/a.mp4",
      '#EXTINF:-1 group-title="VOD Comedy",Movie B',
      "http://example.com/b.mp4",
    ].join("\n");
    const m3uSource = { kind: "m3u-file" as const, id: "m3u-2", name: "M3U", content: m3uContent };

    const result = await loadChannelsByKind(m3uSource, "movie", "VOD Action");

    expect(result.map((c) => c.name)).toEqual(["Movie A"]);
  });
});
