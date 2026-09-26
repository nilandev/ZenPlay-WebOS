import { beforeEach, describe, expect, it } from "vitest";
import { alternateLiveStream, forgetWorkingLiveStreamFormat, liveStreamUrl, rememberWorkingLiveStreamFormat, workingLiveStreamFormat } from "./live-stream-url.js";
import { loadSettings, updateSettings } from "./settings-store.js";

const channel = { streamUrl: "http://tv.example/live/me/pw/42.m3u8" };

describe("live stream URL", () => {
  beforeEach(() => localStorage.clear());

  it("on Auto (the default), starts as HLS until a format has worked for the playlist, then in that one", () => {
    expect(loadSettings().liveStreamFormat).toBe("auto");
    expect(liveStreamUrl(channel, "src-1")).toBe("http://tv.example/live/me/pw/42.m3u8");
    rememberWorkingLiveStreamFormat("src-1", "ts");
    expect(liveStreamUrl(channel, "src-1")).toBe("http://tv.example/live/me/pw/42.ts");
    expect(liveStreamUrl(channel, "src-2")).toBe("http://tv.example/live/me/pw/42.m3u8"); // per playlist
    forgetWorkingLiveStreamFormat("src-1");
    expect(workingLiveStreamFormat("src-1")).toBeUndefined();
  });

  it("a fixed format ignores what worked before", () => {
    rememberWorkingLiveStreamFormat("src-1", "ts");
    updateSettings({ liveStreamFormat: "m3u8" });
    expect(liveStreamUrl(channel, "src-1")).toBe("http://tv.example/live/me/pw/42.m3u8");
    updateSettings({ liveStreamFormat: "ts" });
    expect(liveStreamUrl(channel, "src-2")).toBe("http://tv.example/live/me/pw/42.ts");
  });

  it("leaves M3U channels as they are", () => {
    updateSettings({ liveStreamFormat: "ts" });
    expect(liveStreamUrl({ streamUrl: "http://cdn.example/bbc/index.m3u8" }, "src-1")).toBe("http://cdn.example/bbc/index.m3u8");
  });

  it("names the alternative format", () => {
    expect(alternateLiveStream("http://tv.example/live/me/pw/42.m3u8")).toEqual({ url: "http://tv.example/live/me/pw/42.ts", format: "ts", label: "MPEG-TS" });
    expect(alternateLiveStream("http://cdn.example/bbc/index.m3u8")).toBeUndefined();
  });

  it("moves settings saved before Auto existed onto Auto, keeping a deliberate MPEG-TS", () => {
    localStorage.setItem("iptv.settings.v1", JSON.stringify({ playbackSpeed: 1.5, liveStreamFormat: "m3u8" }));
    expect(loadSettings()).toMatchObject({ playbackSpeed: 1.5, liveStreamFormat: "auto" });
    localStorage.setItem("iptv.settings.v1", JSON.stringify({ liveStreamFormat: "ts" }));
    expect(loadSettings().liveStreamFormat).toBe("ts");
    // Once saved in the new shape, HLS is a real choice.
    updateSettings({ liveStreamFormat: "m3u8" });
    expect(loadSettings().liveStreamFormat).toBe("m3u8");
    expect(loadSettings()).not.toHaveProperty("liveStreamFormatVersion");
  });
});
