import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks hls.js entirely rather than exercising a real instance — this
 * suite is about HlsPlayerEngine's own routing decision (direct-play file
 * vs. real HLS manifest), not hls.js's own manifest-parsing behavior.
 */
const hlsInstances: Array<{
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  subtitleTracks: Array<{ id: number; name: string; lang?: string }>;
  subtitleTrack: number;
}> = [];

vi.mock("hls.js", () => {
  class MockHls {
    static isSupported = vi.fn(() => true);
    static Events = { ERROR: "hlsError", MANIFEST_PARSED: "hlsManifestParsed" };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    off = vi.fn();
    subtitleTracks: Array<{ id: number; name: string; lang?: string }> = [
      { id: 0, name: "English", lang: "en" },
      { id: 1, name: "Spanish", lang: "es" },
    ];
    subtitleTrack = -1;
    once = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      // Auto-resolve load() by immediately firing MANIFEST_PARSED for any
      // real-HLS test case, since nothing here actually parses a manifest.
      if (event === MockHls.Events.MANIFEST_PARSED) cb();
    });

    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: MockHls, Events: MockHls.Events, ErrorTypes: MockHls.ErrorTypes };
});

const { HlsPlayerEngine } = await import("./hls-player-engine.js");
const Hls = (await import("hls.js")).default as unknown as { isSupported: ReturnType<typeof vi.fn> };

function makeVideoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  return video;
}

describe("HlsPlayerEngine.load", () => {
  beforeEach(() => {
    hlsInstances.length = 0;
    (Hls.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("routes a real .m3u8 URL through hls.js", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/live/u/p/1.m3u8");

    expect(hlsInstances).toHaveLength(1);
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith("http://example.com/live/u/p/1.m3u8");
  });

  it("sets video.src directly for an .mkv direct-play URL instead of using hls.js", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/movie/u/p/42.mkv");

    expect(hlsInstances).toHaveLength(0);
    expect(video.src).toContain("42.mkv");
  });

  it("sets video.src directly for an .mp4 direct-play URL instead of using hls.js", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/movie/u/p/7.mp4");

    expect(hlsInstances).toHaveLength(0);
    expect(video.src).toContain("7.mp4");
  });

  it("still treats an .m3u8 URL with a query string as HLS", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/live/u/p/1.m3u8?token=abc");

    expect(hlsInstances).toHaveLength(1);
  });

  it("still treats an .mkv URL with a query string as direct-play, not HLS", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/movie/u/p/9.mkv?token=abc");

    expect(hlsInstances).toHaveLength(0);
    expect(video.src).toContain("9.mkv");
  });

  it("falls back to native video.src for an .m3u8 URL when Hls.isSupported() is false", async () => {
    (Hls.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    await engine.load("http://example.com/live/u/p/1.m3u8");

    expect(hlsInstances).toHaveLength(0);
    expect(video.src).toContain("1.m3u8");
  });
});

describe("HlsPlayerEngine subtitle/volume controls", () => {
  beforeEach(() => {
    hlsInstances.length = 0;
    (Hls.isSupported as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("lists subtitle tracks exposed by hls.js", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);
    await engine.load("http://example.com/live/u/p/1.m3u8");

    expect(engine.getSubtitleTracks()).toEqual([
      { id: 0, label: "English", language: "en" },
      { id: 1, label: "Spanish", language: "es" },
    ]);
  });

  it("returns no subtitle tracks for a direct-play file (no hls.js instance)", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);
    await engine.load("http://example.com/movie/u/p/42.mkv");

    expect(engine.getSubtitleTracks()).toEqual([]);
  });

  it("sets hls.subtitleTrack to -1 when disabling subtitles", async () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);
    await engine.load("http://example.com/live/u/p/1.m3u8");

    engine.setSubtitleTrack(1);
    expect(hlsInstances[0].subtitleTrack).toBe(1);

    engine.setSubtitleTrack(null);
    expect(hlsInstances[0].subtitleTrack).toBe(-1);
  });

  it("clamps setVolume to [0, 1] on the underlying video element", () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    engine.setVolume(0.4);
    expect(video.volume).toBe(0.4);

    engine.setVolume(5);
    expect(video.volume).toBe(1);

    engine.setVolume(-1);
    expect(video.volume).toBe(0);
  });

  it("sets muted on the underlying video element", () => {
    const engine = new HlsPlayerEngine();
    const video = makeVideoElement();
    engine.attach(video);

    engine.setMuted(true);
    expect(video.muted).toBe(true);

    engine.setMuted(false);
    expect(video.muted).toBe(false);
  });
});
