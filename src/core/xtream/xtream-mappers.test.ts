import { describe, expect, it } from "vitest";
import { buildXtreamStreamUrl, mapEpgListing, mapLiveStream, mapSeriesEntry, mapVodStream } from "./xtream-mappers.js";

const credentials = { baseUrl: "http://example.com", username: "user", password: "pass" };

describe("buildXtreamStreamUrl", () => {
  it("builds a stream URL from credentials, kind, id, and extension", () => {
    expect(buildXtreamStreamUrl(credentials, "movie", 42, "mp4")).toBe("http://example.com/movie/user/pass/42.mp4");
  });

  it("strips a trailing slash from baseUrl", () => {
    expect(buildXtreamStreamUrl({ ...credentials, baseUrl: "http://example.com/" }, "live", 1, "m3u8")).toBe(
      "http://example.com/live/user/pass/1.m3u8",
    );
  });
});

describe("mapVodStream", () => {
  it("carries only the fields the VOD browse grid needs, no archive-related keys at all", () => {
    const mapped = mapVodStream(credentials, {
      stream_id: 7,
      name: "A Movie",
      stream_icon: "http://logo.png",
      category_id: "cat-1",
      container_extension: "mkv",
    });

    expect(mapped).toEqual({
      id: "7",
      name: "A Movie",
      logoUrl: "http://logo.png",
      groupTitle: "cat-1",
      streamUrl: "http://example.com/movie/user/pass/7.mkv",
      kind: "movie",
    });
    expect("hasArchive" in mapped).toBe(false);
    expect("archiveDurationDays" in mapped).toBe(false);
  });

  it("defaults the stream extension to mp4 when the provider omits container_extension", () => {
    const mapped = mapVodStream(credentials, { stream_id: 1, name: "X" });
    expect(mapped.streamUrl).toBe("http://example.com/movie/user/pass/1.mp4");
  });
});

describe("mapLiveStream", () => {
  it("maps archive fields for catch-up support, which VOD entries never carry", () => {
    const mapped = mapLiveStream(credentials, {
      stream_id: 3,
      name: "News",
      category_id: "cat-2",
      epg_channel_id: "news.uk",
      tv_archive: 1,
      tv_archive_duration: 7,
    });

    expect(mapped).toMatchObject({
      id: "3",
      kind: "live",
      epgChannelId: "news.uk",
      hasArchive: true,
      archiveDurationDays: 7,
    });
  });

  it("hasArchive is false when tv_archive is absent or 0", () => {
    const mapped = mapLiveStream(credentials, { stream_id: 4, name: "Channel" });
    expect(mapped.hasArchive).toBe(false);
  });
});

describe("mapSeriesEntry", () => {
  it("maps the browse-grid summary shape", () => {
    const mapped = mapSeriesEntry({ series_id: 9, name: "A Show", cover: "http://cover.png", category_id: "cat-3" });
    expect(mapped).toEqual({ id: "9", name: "A Show", posterUrl: "http://cover.png", groupTitle: "cat-3" });
  });
});

describe("mapEpgListing", () => {
  it("decodes base64 title/description and converts unix-second timestamps to Dates", () => {
    const mapped = mapEpgListing({
      channel_id: "Star.Sports.2.Hindi.HD.in",
      start_timestamp: 1790015400,
      stop_timestamp: 1790017200,
      title: "T25lLURheSBJbnRlcm5hdGlvbmFsIENyaWNrZXQ=",
      description:
        "QW4gZXh0ZW5zaXZlIGFuZCB0aG9yb3VnaCBjb3ZlcmFnZSBvZiBvbmUtZGF5IGNyaWNrZXQgbWF0Y2hlcyBjb250ZXN0ZWQgYnkgdmFyaW91cyBpbnRlcm5hdGlvbmFsIHRlYW1zIGZyb20gYWNyb3NzIHRoZSBnbG9iZS4=",
    });

    expect(mapped.channelId).toBe("Star.Sports.2.Hindi.HD.in");
    expect(mapped.title).toBe("One-Day International Cricket");
    expect(mapped.description).toBe(
      "An extensive and thorough coverage of one-day cricket matches contested by various international teams from across the globe.",
    );
    expect(mapped.start).toEqual(new Date(1790015400 * 1000));
    expect(mapped.stop).toEqual(new Date(1790017200 * 1000));
  });

  it("falls back to the raw string when a field isn't valid base64, instead of throwing", () => {
    const mapped = mapEpgListing({
      channel_id: "ch1",
      start_timestamp: 0,
      stop_timestamp: 60,
      title: "not valid base64 !!!",
    });
    expect(mapped.title).toBe("not valid base64 !!!");
  });

  it("leaves description undefined when the provider omits it", () => {
    const mapped = mapEpgListing({ channel_id: "ch1", start_timestamp: 0, stop_timestamp: 60, title: "VGl0bGU=" });
    expect(mapped.description).toBeUndefined();
  });
});
