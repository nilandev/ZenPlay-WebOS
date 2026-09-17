import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelPreloader } from "./channel-preloader.js";

describe("ChannelPreloader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not claim anything before the debounce window elapses", () => {
    const preloader = new ChannelPreloader(250);
    preloader.warm("http://example.com/a.m3u8");
    expect(preloader.claim("http://example.com/a.m3u8")).toBeNull();
  });

  it("ignores rapid successive warm() calls for different channels until debounce settles", () => {
    const preloader = new ChannelPreloader(250);
    preloader.warm("http://example.com/a.m3u8");
    vi.advanceTimersByTime(100);
    preloader.warm("http://example.com/b.m3u8");
    vi.advanceTimersByTime(100);
    // Still within debounce of the second call; neither should be claimable yet.
    expect(preloader.claim("http://example.com/a.m3u8")).toBeNull();
    expect(preloader.claim("http://example.com/b.m3u8")).toBeNull();
  });

  it("dispose() clears pending timers without throwing", () => {
    const preloader = new ChannelPreloader(250);
    preloader.warm("http://example.com/a.m3u8");
    expect(() => preloader.dispose()).not.toThrow();
  });

  it("treats repeated warm() calls with the same URL as a no-op", () => {
    const preloader = new ChannelPreloader(250);
    preloader.warm("http://example.com/a.m3u8");
    preloader.warm("http://example.com/a.m3u8");
    // No assertion on internal state directly; primarily verifying no throw/debounce reset issues.
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
  });
});
