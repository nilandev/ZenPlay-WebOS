import { describe, expect, it } from "vitest";
import { parseM3u } from "./parse-m3u.js";

describe("parseM3u", () => {
  it("parses a well-formed playlist with full attributes", () => {
    const content = `#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://logo/bbc1.png" group-title="UK",BBC One
http://example.com/live/bbc1.m3u8
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" group-title="News",CNN
http://example.com/live/cnn.m3u8`;

    const channels = parseM3u(content);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toMatchObject({
      id: "bbc1.uk",
      name: "BBC One",
      logoUrl: "http://logo/bbc1.png",
      groupTitle: "UK",
      streamUrl: "http://example.com/live/bbc1.m3u8",
      kind: "live",
    });
    expect(channels[1].name).toBe("CNN");
  });

  it("falls back to the trailing comma name when tvg-name is missing", () => {
    const content = `#EXTINF:-1,Just A Name
http://example.com/stream.m3u8`;
    const channels = parseM3u(content);
    expect(channels[0].name).toBe("Just A Name");
  });

  it("handles CRLF line endings and blank lines", () => {
    const content = "#EXTM3U\r\n\r\n#EXTINF:-1,Channel A\r\nhttp://example.com/a.m3u8\r\n\r\n";
    const channels = parseM3u(content);
    expect(channels).toHaveLength(1);
    expect(channels[0].streamUrl).toBe("http://example.com/a.m3u8");
  });

  it("assigns a synthetic id when tvg-id is absent", () => {
    const content = `#EXTINF:-1,No ID Channel
http://example.com/noid.m3u8`;
    const channels = parseM3u(content);
    expect(channels[0].id).toMatch(/^m3u-\d+$/);
  });

  it("ignores unrelated directive lines like #EXTVLCOPT and #EXTGRP", () => {
    const content = `#EXTM3U
#EXTINF:-1,Channel A
#EXTVLCOPT:http-user-agent=Foo
#EXTGRP:Sports
http://example.com/a.m3u8`;
    const channels = parseM3u(content);
    expect(channels).toHaveLength(1);
    expect(channels[0].streamUrl).toBe("http://example.com/a.m3u8");
  });

  it("detects movie and series kinds from URL/group hints", () => {
    const content = `#EXTINF:-1 group-title="Movies",Some Movie
http://example.com/vod/movie.mp4
#EXTINF:-1 group-title="Series",Show S01E02
http://example.com/series/show/1/2.mp4`;
    const channels = parseM3u(content);
    expect(channels[0].kind).toBe("movie");
    expect(channels[1].kind).toBe("series");
  });

  it("returns an empty array for empty input", () => {
    expect(parseM3u("")).toEqual([]);
  });
});
