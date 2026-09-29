import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMuteStatus, subscribeTvMute } from "./tv-audio.js";

describe("tv-audio", () => {
  afterEach(() => {
    delete (globalThis as { PalmServiceBridge?: unknown }).PalmServiceBridge;
  });

  it("reads the mute flag from old and new webOS responses", () => {
    expect(parseMuteStatus(JSON.stringify({ returnValue: true, muted: true }))).toBe(true);
    expect(parseMuteStatus(JSON.stringify({ returnValue: true, volumeStatus: { sessionId: 0, muted: true, volume: 12, soundOutput: "tv_speaker" } }))).toBe(true);
    expect(parseMuteStatus(JSON.stringify({ returnValue: true, volumeStatus: { muteStatus: false } }))).toBe(false);
    expect(parseMuteStatus(JSON.stringify({ returnValue: true, muteStatus: true }))).toBe(true);
    expect(parseMuteStatus(JSON.stringify({ returnValue: false, errorText: "Denied" }))).toBeNull();
    expect(parseMuteStatus("not json")).toBeNull();
  });

  it("does nothing outside webOS", () => {
    const onChange = vi.fn();
    subscribeTvMute(onChange)();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("subscribes to the TV's volume and reports mute changes until cancelled", () => {
    const bridges: { onservicecallback: ((m: string) => void) | null; call: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
    (globalThis as { PalmServiceBridge?: unknown }).PalmServiceBridge = function (this: (typeof bridges)[number]) {
      this.onservicecallback = null;
      this.call = vi.fn();
      this.cancel = vi.fn();
      bridges.push(this);
    };
    const onChange = vi.fn();
    const unsubscribe = subscribeTvMute(onChange);
    expect(bridges[0].call).toHaveBeenCalledWith("luna://com.webos.audio/master/getVolume", JSON.stringify({ subscribe: true }));
    bridges[0].onservicecallback?.(JSON.stringify({ returnValue: true, volumeStatus: { muteStatus: true } }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    unsubscribe();
    expect(bridges[0].cancel).toHaveBeenCalled();
  });

  it("falls back to the older service when the newer one isn't there", () => {
    vi.useFakeTimers();
    const bridges: { onservicecallback: ((m: string) => void) | null; call: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[] = [];
    (globalThis as { PalmServiceBridge?: unknown }).PalmServiceBridge = function (this: (typeof bridges)[number]) {
      this.onservicecallback = null;
      this.call = vi.fn();
      this.cancel = vi.fn();
      bridges.push(this);
    };
    const onChange = vi.fn();
    subscribeTvMute(onChange);
    bridges[0].onservicecallback?.(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Unknown method "getVolume" for category "/master"' }));
    vi.runAllTimers();
    expect(bridges[1].call).toHaveBeenCalledWith("luna://com.webos.service.audio/master/getVolume", JSON.stringify({ subscribe: true }));
    bridges[1].onservicecallback?.(JSON.stringify({ returnValue: false, errorCode: -1, errorText: "Service does not exist: com.webos.service.audio." }));
    vi.runAllTimers();
    expect(bridges[2].call).toHaveBeenCalledWith("luna://com.webos.audio/getVolume", JSON.stringify({ subscribe: true }));
    bridges[2].onservicecallback?.(JSON.stringify({ returnValue: true, muted: true }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    vi.useRealTimers();
  });
});
