import { beforeEach, describe, expect, it } from "vitest";
import { alternateLiveStream, liveStreamUrl } from "./live-stream-url.js";
import { updateSettings } from "./settings-store.js";

describe("live stream URL", () => {
  beforeEach(() => localStorage.clear());

  it("plays Xtream live channels as HLS by default, and as MPEG-TS when chosen", () => {
    const channel = { streamUrl: "http://tv.example/live/me/pw/42.m3u8" };
    expect(liveStreamUrl(channel)).toBe("http://tv.example/live/me/pw/42.m3u8");
    updateSettings({ liveStreamFormat: "ts" });
    expect(liveStreamUrl(channel)).toBe("http://tv.example/live/me/pw/42.ts");
  });

  it("leaves M3U channels as they are", () => {
    updateSettings({ liveStreamFormat: "ts" });
    expect(liveStreamUrl({ streamUrl: "http://cdn.example/bbc/index.m3u8" })).toBe("http://cdn.example/bbc/index.m3u8");
  });

  it("names the alternative format", () => {
    expect(alternateLiveStream("http://tv.example/live/me/pw/42.m3u8")).toEqual({ url: "http://tv.example/live/me/pw/42.ts", format: "ts", label: "MPEG-TS" });
    expect(alternateLiveStream("http://cdn.example/bbc/index.m3u8")).toBeUndefined();
  });
});
