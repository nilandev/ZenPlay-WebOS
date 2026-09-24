import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XtreamAuthError, XtreamClient, __resetRequestDedupeCacheForTests } from "./xtream-client.js";
import type { XtreamCredentials } from "../models/playlist-source.js";

const credentials: XtreamCredentials = {
  kind: "xtream",
  id: "provider-1",
  name: "Test Provider",
  baseUrl: "http://example.com:8080/",
  username: "user",
  password: "pass",
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("XtreamClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    __resetRequestDedupeCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips trailing slashes when building the API URL", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));
    const client = new XtreamClient(credentials);
    await client.authenticate();

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe("http://example.com:8080/player_api.php");
    expect(calledUrl.searchParams.get("username")).toBe("user");
  });

  it("throws XtreamAuthError when auth is not 1", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));
    const client = new XtreamClient(credentials);
    await expect(client.authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
  });

  it("dedupes concurrent authenticate() calls across separate client instances for the same source", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));

    // Mirrors HomeScreen's real pattern: several independent loaders each
    // construct their own XtreamClient for the same source and authenticate
    // in parallel (see content-loader.ts) — this should collapse into one
    // network call rather than one per client.
    const results = await Promise.all([
      new XtreamClient(credentials).authenticate(),
      new XtreamClient(credentials).authenticate(),
      new XtreamClient(credentials).authenticate(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.user_info.auth === 1)).toBe(true);
  });

  it("dedupes concurrent identical data calls (get_series) across separate client instances for the same source", async () => {
    // Mirrors the real HomeScreen + SeriesScreen overlap: both independently
    // call getSeriesList() with no category filter for the same source —
    // see conversation history ("extend the same dedup pattern to these
    // data calls").
    fetchMock.mockResolvedValueOnce(jsonResponse([{ series_id: 1, name: "Series 1", cover: "", category_id: "1" }]));

    const results = await Promise.all([new XtreamClient(credentials).getSeriesList(), new XtreamClient(credentials).getSeriesList()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
  });

  it("does not dedupe calls with different params (different category_id) for the same source/action", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await Promise.all([new XtreamClient(credentials).getSeriesList("1"), new XtreamClient(credentials).getSeriesList("2")]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe calls for a different source id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));
    const otherCredentials: XtreamCredentials = { ...credentials, id: "provider-2" };

    await Promise.all([new XtreamClient(credentials).authenticate(), new XtreamClient(otherCredentials).authenticate()]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not keep replaying a failed call within the dedupe window", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));

    await expect(new XtreamClient(credentials).authenticate()).rejects.toBeInstanceOf(XtreamAuthError);
    await expect(new XtreamClient(credentials).authenticate()).resolves.toMatchObject({ user_info: { auth: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects every concurrent authenticate() call sharing a failed dedupe response, then allows a real retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 0 }, server_info: {} }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));

    const [first, second] = await Promise.allSettled([
      new XtreamClient(credentials).authenticate(),
      new XtreamClient(credentials).authenticate(),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the two concurrent calls shared one fetch

    await expect(new XtreamClient(credentials).authenticate()).resolves.toMatchObject({ user_info: { auth: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps live streams into Channel objects with a working stream URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { stream_id: 101, name: "BBC One", stream_icon: "http://logo/1.png", category_id: "1", tv_archive: 1, tv_archive_duration: 7 },
      ]),
    );
    const client = new XtreamClient(credentials);
    const channels = await client.getLiveChannels();

    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      id: "101",
      name: "BBC One",
      kind: "live",
      hasArchive: true,
      archiveDurationDays: 7,
      streamUrl: "http://example.com:8080/live/user/pass/101.m3u8",
    });
  });

  it("fetches and maps per-stream EPG listings via get_epg", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        epg_listings: [
          {
            channel_id: "ch1",
            start_timestamp: 1790015400,
            stop_timestamp: 1790017200,
            title: "T25lLURheSBJbnRlcm5hdGlvbmFsIENyaWNrZXQ=",
          },
        ],
      }),
    );
    const client = new XtreamClient(credentials);
    const programmes = await client.getShortEpg("18335");

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("action")).toBe("get_epg");
    expect(calledUrl.searchParams.get("stream_id")).toBe("18335");
    expect(programmes).toEqual([
      {
        channelId: "ch1",
        title: "One-Day International Cricket",
        description: undefined,
        start: new Date(1790015400 * 1000),
        stop: new Date(1790017200 * 1000),
      },
    ]);
  });

  it("returns an empty list when the provider omits epg_listings", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const client = new XtreamClient(credentials);
    await expect(client.getShortEpg("1")).resolves.toEqual([]);
  });

  it("builds a catch-up URL with start/duration params", () => {
    const client = new XtreamClient(credentials);
    const url = client.buildCatchupUrl("101", 1700000000, 60);
    expect(url).toContain("stream=101");
    expect(url).toContain("start=1700000000");
    expect(url).toContain("duration=60");
  });

  it("flattens series episodes across seasons", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        episodes: {
          "1": [{ id: "1", title: "Pilot", container_extension: "mp4", episode_num: 1, season: 1 }],
          "2": [{ id: "2", title: "S2E1", container_extension: "mp4", episode_num: 1, season: 2 }],
        },
      }),
    );
    const client = new XtreamClient(credentials);
    const episodes = await client.getSeriesInfo("55");
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e) => e.season)).toEqual([1, 2]);
  });

  it("parses series-level metadata alongside episodes from get_series_info", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        info: {
          plot: "A group of kids battle a supernatural force.",
          cast: "Millie Bobby Brown, Finn Wolfhard",
          genre: "Sci-Fi, Horror",
          releaseDate: "2016-07-15",
          rating: "8.7",
          backdrop_path: ["https://example.com/backdrop.jpg"],
        },
        episodes: {
          "1": [{ id: "1", title: "Pilot", container_extension: "mp4", episode_num: 1, season: 1 }],
        },
      }),
    );
    const client = new XtreamClient(credentials);
    const { details, episodes } = await client.getSeriesDetails("55");
    expect(details).toEqual({
      plot: "A group of kids battle a supernatural force.",
      cast: ["Millie Bobby Brown", "Finn Wolfhard"],
      director: undefined,
      genre: ["Sci-Fi", "Horror"],
      releaseDate: "2016-07-15",
      lastAirDate: undefined,
      rating: 8.7,
      backdropUrl: "https://example.com/backdrop.jpg",
      trailerUrl: undefined,
    });
    expect(episodes).toHaveLength(1);
  });

  it("maps get_vod_info into movie details", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        info: { plot: "A team travels through a wormhole.", genre: "Sci-Fi, Drama", releasedate: "2014-11-07", rating: "8.6", backdrop_path: ["https://example.com/b.jpg"], duration_secs: 10140 },
      }),
    );
    const client = new XtreamClient(credentials);
    expect(await client.getVodDetails("77")).toEqual({
      plot: "A team travels through a wormhole.",
      genre: ["Sci-Fi", "Drama"],
      releaseDate: "2014-11-07",
      rating: 8.6,
      backdropUrl: "https://example.com/b.jpg",
      durationSeconds: 10140,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("action=get_vod_info");
  });

  it("treats a missing or zero rating/info block as absent rather than defaulting to zero", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ info: { rating: "0" }, episodes: {} }));
    const client = new XtreamClient(credentials);
    const { details } = await client.getSeriesDetails("55");
    expect(details.rating).toBeUndefined();
  });

  it("falls back to an empty details object when the provider omits the info block entirely", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ episodes: {} }));
    const client = new XtreamClient(credentials);
    const { details, episodes } = await client.getSeriesDetails("55");
    expect(details).toEqual({
      plot: undefined,
      cast: undefined,
      director: undefined,
      genre: undefined,
      releaseDate: undefined,
      lastAirDate: undefined,
      rating: undefined,
      backdropUrl: undefined,
      trailerUrl: undefined,
    });
    expect(episodes).toEqual([]);
  });

  it("throws on a non-OK HTTP response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    const client = new XtreamClient(credentials);
    await expect(client.authenticate()).rejects.toThrow(/HTTP 500/);
  });

  it("uses an injected fetch implementation instead of the global one when provided", async () => {
    const injectedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ user_info: { auth: 1 }, server_info: {} }));
    const client = new XtreamClient(credentials, injectedFetch);
    await client.authenticate();

    expect(injectedFetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
