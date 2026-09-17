import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XtreamAuthError, XtreamClient } from "./xtream-client.js";
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
