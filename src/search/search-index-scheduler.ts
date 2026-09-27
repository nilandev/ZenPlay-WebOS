import { LITE_EFFECTS } from "@ui";
import { useSyncStore } from "../sync/sync-store.js";
import type { SearchIndexRequest, SearchIndexResponse } from "../workers/search-index-protocol.js";
import type { SearchIndexJob } from "./search-indexer.js";

/**
 * Decides when the background search indexer may run — the lowest-priority
 * work in the app (docs/global-search-plan.md, "When the indexer may run").
 * It runs only while all of these hold, and is paused the moment any stops
 * holding, resuming once they've all held again for `idleMs`:
 *
 * - no remote or keyboard input,
 * - nothing playing (the player needs the CPU for video),
 * - no sync running for any playlist,
 * - the app in the foreground.
 *
 * The main thread does no indexing work: it only tells the worker to run
 * or pause. The worker is created on the first idle window and terminated
 * once everything is indexed; a finished sync makes it wanted again.
 */

/** What the scheduler needs from a worker — a real Worker, or a stand-in in tests. */
export interface SearchIndexWorkerLike {
  postMessage(message: SearchIndexRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SearchIndexResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface SearchIndexSchedulerOptions {
  /** What to index, in order — read each time a run starts. */
  getJobs: () => SearchIndexJob[];
  /** Null where workers aren't available: then nothing is indexed (never on the main thread) and search stays on prefix matching. */
  createWorker?: () => SearchIndexWorkerLike | null;
  /** How long everything must have been quiet before a run starts. */
  idleMs?: number;
  /** How often to check whether a run may start. */
  pollMs?: number;
  /** The worker's pause after each unit. */
  paceMs?: number;
  /** After a failed run, wait this long before trying again. */
  retryAfterMs?: number;
}

function createSearchIndexWorker(): SearchIndexWorkerLike | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("../workers/search-index-worker.ts", import.meta.url), { type: "module" }) as unknown as SearchIndexWorkerLike;
}

let playbackActive = false;
const playbackListeners = new Set<() => void>();

/** App reports whether the player is open — indexing never runs during playback. */
export function setSearchIndexPlaybackActive(active: boolean): void {
  if (active === playbackActive) return;
  playbackActive = active;
  for (const listener of playbackListeners) listener();
}

let pauseCurrent: (() => Promise<void>) | null = null;

/**
 * Pauses indexing and resolves once the worker has stopped (or straight
 * away if it isn't running) — so removing a playlist can delete its rows
 * without a unit still in flight writing some back.
 */
export function pauseSearchIndexing(): Promise<void> {
  return pauseCurrent ? pauseCurrent() : Promise.resolve();
}

/** How long pauseSearchIndexing waits for the worker before giving up on it. */
const PAUSE_TIMEOUT_MS = 3000;

export function startSearchIndexScheduler(options: SearchIndexSchedulerOptions): () => void {
  const {
    getJobs,
    createWorker = createSearchIndexWorker,
    idleMs = 3000,
    pollMs = 1000,
    paceMs = LITE_EFFECTS ? 400 : 150,
    retryAfterMs = 60_000,
  } = options;

  let state: "idle" | "running" | "pausing" = "idle";
  let wanted = true;
  let lastBusyAt = Date.now(); // launch counts as activity: the app's own start-up comes first
  let retryAt = 0;
  let worker: SearchIndexWorkerLike | null = null;
  let settledWaiters: Array<() => void> = [];

  const anySyncRunning = () => Object.values(useSyncStore.getState().sources).some((source) => source.isRunning);
  const isBusy = () => playbackActive || anySyncRunning() || document.visibilityState === "hidden";

  function settle(): void {
    state = "idle";
    const waiters = settledWaiters;
    settledWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function dropWorker(): void {
    worker?.terminate();
    worker = null;
  }

  function pause(): void {
    if (state !== "running" || !worker) return;
    state = "pausing";
    worker.postMessage({ type: "pause" });
  }

  /** Something the user (or the app) is doing: pause now, and restart the quiet period. */
  function markBusy(): void {
    lastBusyAt = Date.now();
    pause();
  }

  function onResponse(message: SearchIndexResponse): void {
    if (message.type === "done") {
      wanted = false;
      dropWorker();
    } else if (message.type === "error") {
      retryAt = Date.now() + retryAfterMs;
      dropWorker();
    }
    settle();
  }

  function tick(): void {
    if (!wanted || state !== "idle") return;
    const now = Date.now();
    if (isBusy() || now - lastBusyAt < idleMs || now < retryAt) return;
    const jobs = getJobs();
    if (jobs.length === 0) {
      wanted = false;
      return;
    }
    if (!worker) {
      worker = createWorker();
      if (!worker) {
        wanted = false;
        return;
      }
      worker.onmessage = (event) => onResponse(event.data);
      worker.onerror = () => onResponse({ type: "error", message: "Search index worker failed" });
    }
    state = "running";
    worker.postMessage({ type: "run", jobs, paceMs });
  }

  const onInput = () => markBusy();
  const onVisibility = () => markBusy();
  const onPlayback = () => markBusy();
  document.addEventListener("keydown", onInput, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  playbackListeners.add(onPlayback);
  let wasSyncing = anySyncRunning();
  const unsubscribeSync = useSyncStore.subscribe(() => {
    const syncing = anySyncRunning();
    if (syncing === wasSyncing) return;
    wasSyncing = syncing;
    markBusy();
    if (!syncing) wanted = true; // a finished sync may have changed what's indexed
  });
  const interval = setInterval(tick, pollMs);

  const pauseThis = () => {
    if (state === "idle") return Promise.resolve();
    pause();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        dropWorker(); // unresponsive: a terminated worker's open transaction is rolled back, never half-written
        settle();
      }, PAUSE_TIMEOUT_MS);
      settledWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  };
  pauseCurrent = pauseThis;

  return () => {
    clearInterval(interval);
    document.removeEventListener("keydown", onInput, { capture: true });
    document.removeEventListener("visibilitychange", onVisibility);
    playbackListeners.delete(onPlayback);
    unsubscribeSync();
    dropWorker();
    settle();
    if (pauseCurrent === pauseThis) pauseCurrent = null;
  };
}
