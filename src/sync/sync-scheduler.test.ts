import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistSource } from "@core";
import { startSyncScheduler } from "./sync-scheduler.js";
import { __resetSyncStoreForTests, useSyncStore } from "./sync-store.js";

const m = vi.hoisted(() => ({ syncSource: vi.fn(), cancelSync: vi.fn() }));
vi.mock("./sync-manager.js", () => ({ syncSource: m.syncSource, cancelSync: m.cancelSync }));

const source: PlaylistSource = { kind: "xtream", id: "src-1", name: "P", baseUrl: "http://tv.example", username: "u", password: "p" };
const MIN = 60 * 1000;
const triggers = () => m.syncSource.mock.calls.map(([, request]) => request.trigger);

let visibility: DocumentVisibilityState = "visible";
function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("sync scheduler", () => {
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    __resetSyncStoreForTests();
    m.syncSource.mockResolvedValue({ stages: {}, errors: {} });
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    stop = startSyncScheduler(source, { launchDelayMs: 3000, intervalMs: 30 * MIN, resumeAfterMs: 30 * MIN });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs a launch sync once the start-up delay has passed", async () => {
    await vi.advanceTimersByTimeAsync(2999);
    expect(m.syncSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(m.syncSource).toHaveBeenCalledWith(source, { trigger: "launch" });
  });

  it("checks on an interval, but only while the app is visible", async () => {
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(triggers()).toEqual(["launch", "interval"]);

    visibility = "hidden"; // no event: the interval itself must check
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(triggers()).toEqual(["launch", "interval"]);
  });

  it("syncs on return from a long spell in the background, not a short one", async () => {
    await vi.advanceTimersByTimeAsync(3000);
    m.syncSource.mockClear();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(5 * MIN);
    setVisibility("visible");
    expect(m.syncSource).not.toHaveBeenCalled();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(29 * MIN); // the interval won't fire while hidden
    await vi.advanceTimersByTimeAsync(2 * MIN);
    setVisibility("visible");
    expect(triggers()).toEqual(["resume"]);
  });

  it("treats webOS's relaunch event like coming back to the foreground", async () => {
    await vi.advanceTimersByTimeAsync(3000);
    m.syncSource.mockClear();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(45 * MIN);
    document.dispatchEvent(new Event("webOSRelaunch"));
    expect(triggers()).toEqual(["resume"]);
  });

  it("retries when the network comes back, but only if something failed", async () => {
    window.dispatchEvent(new Event("online"));
    expect(m.syncSource).not.toHaveBeenCalled();

    useSyncStore.getState().setStage(source.id, "vod", { status: "failed", error: "Failed to fetch" });
    window.dispatchEvent(new Event("online"));
    expect(triggers()).toEqual(["online"]);
  });

  it("stopping removes every trigger and cancels the source's running sync", async () => {
    stop();
    expect(m.cancelSync).toHaveBeenCalledWith(source.id);

    await vi.advanceTimersByTimeAsync(2 * 30 * MIN);
    useSyncStore.getState().setStage(source.id, "vod", { status: "failed" });
    window.dispatchEvent(new Event("online"));
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(60 * MIN);
    setVisibility("visible");
    expect(m.syncSource).not.toHaveBeenCalled();
    stop = () => {};
  });
});
