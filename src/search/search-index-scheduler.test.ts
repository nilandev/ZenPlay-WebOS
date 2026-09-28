import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetSyncStoreForTests, useSyncStore } from "../sync/sync-store.js";
import type { SearchIndexRequest, SearchIndexResponse } from "../workers/search-index-protocol.js";
import { pauseSearchIndexing, setSearchIndexPlaybackActive, startSearchIndexScheduler, type SearchIndexWorkerLike } from "./search-index-scheduler.js";

/** A stand-in worker that records what it was told and answers when the test says so. */
class FakeWorker implements SearchIndexWorkerLike {
  messages: SearchIndexRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<SearchIndexResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: SearchIndexRequest): void {
    this.messages.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(message: SearchIndexResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<SearchIndexResponse>);
  }
  get types(): string[] {
    return this.messages.map((m) => m.type);
  }
}

const JOBS = [{ sourceId: "src-1", kind: "vod" as const }];
let workers: FakeWorker[];
let stop: () => void;

function start(): void {
  stop = startSearchIndexScheduler({
    getJobs: () => JOBS,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    idleMs: 3000,
    pollMs: 1000,
    paceMs: 150,
    retryAfterMs: 60_000,
  });
}
const latest = () => workers[workers.length - 1];
const press = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  __resetSyncStoreForTests();
  setSearchIndexPlaybackActive(false);
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("search index scheduler", () => {
  it("waits for 3 s of quiet after launch, then runs the jobs in a worker", () => {
    start();
    vi.advanceTimersByTime(2000);
    expect(workers).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(latest().messages).toEqual([{ type: "run", jobs: JOBS, paceMs: 150 }]);
  });

  it("a key press pauses the run straight away, and it resumes only after 3 s without one", () => {
    start();
    vi.advanceTimersByTime(3000);
    press();
    expect(latest().types).toEqual(["run", "pause"]);
    latest().reply({ type: "paused" });

    vi.advanceTimersByTime(2000);
    press(); // still using the remote: the quiet period starts again
    vi.advanceTimersByTime(2000);
    expect(latest().types).toEqual(["run", "pause"]);
    vi.advanceTimersByTime(1000);
    expect(latest().types).toEqual(["run", "pause", "run"]);
  });

  it("never runs during playback or a sync, or while the app is hidden", () => {
    start();
    setSearchIndexPlaybackActive(true);
    vi.advanceTimersByTime(10_000);
    expect(workers).toHaveLength(0);
    setSearchIndexPlaybackActive(false);

    useSyncStore.getState().beginRun("src-1", "launch");
    vi.advanceTimersByTime(10_000);
    expect(workers).toHaveLength(0);
    useSyncStore.getState().endRun("src-1");

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(10_000);
    expect(workers).toHaveLength(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(3000);
    expect(latest().types).toEqual(["run"]);
  });

  it("playback or a sync starting mid-run pauses it", () => {
    start();
    vi.advanceTimersByTime(3000);
    setSearchIndexPlaybackActive(true);
    expect(latest().types).toEqual(["run", "pause"]);
    latest().reply({ type: "paused" });
    setSearchIndexPlaybackActive(false);

    vi.advanceTimersByTime(3000);
    useSyncStore.getState().beginRun("src-1", "interval");
    expect(latest().types).toEqual(["run", "pause", "run", "pause"]);
  });

  it("once everything is indexed the worker is shut down, and a finished sync makes it wanted again", () => {
    start();
    vi.advanceTimersByTime(3000);
    const first = latest();
    first.reply({ type: "done" });
    expect(first.terminated).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(workers).toHaveLength(1); // nothing more to do

    useSyncStore.getState().beginRun("src-1", "interval");
    useSyncStore.getState().endRun("src-1");
    vi.advanceTimersByTime(3000);
    expect(workers).toHaveLength(2);
    expect(latest().types).toEqual(["run"]);
  });

  it("after a failed run it waits before trying again", () => {
    start();
    vi.advanceTimersByTime(3000);
    latest().reply({ type: "error", message: "boom" });
    vi.advanceTimersByTime(30_000);
    expect(workers).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(workers).toHaveLength(2);
  });

  it("pauseSearchIndexing resolves once the worker has stopped", async () => {
    start();
    await expect(pauseSearchIndexing()).resolves.toBeUndefined(); // not running: straight away
    vi.advanceTimersByTime(3000);

    let resolved = false;
    void pauseSearchIndexing().then(() => (resolved = true));
    expect(latest().types).toEqual(["run", "pause"]);
    await Promise.resolve();
    expect(resolved).toBe(false);
    latest().reply({ type: "paused" });
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
