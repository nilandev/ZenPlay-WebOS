import { create } from "zustand";

/** The stages of one source's sync, in the order they run (auth first; live/vod/series in parallel; the guide last). */
export type SyncStage = "auth" | "live" | "vod" | "series" | "epg";
export type ContentStage = Exclude<SyncStage, "auth">;
export const CONTENT_STAGES: ContentStage[] = ["live", "vod", "series", "epg"];

/** What asked for a sync — shown nowhere yet, but recorded so the UI (Phase 3) can word progress differently for a first run vs. a manual refresh. */
export type SyncTrigger = "first-run" | "launch" | "resume" | "interval" | "online" | "manual";

export type StageStatus =
  /** Waiting for its turn in the running job. */
  | "pending"
  | "running"
  | "synced"
  /** Didn't need to run: its data is still within its freshness window. */
  | "fresh"
  | "failed"
  /** Not run because an earlier step failed (sign-in) or the job was cancelled. */
  | "skipped"
  /** Doesn't exist for this source (e.g. series or a guide on an M3U playlist without one). */
  | "not-applicable";

export interface StageState {
  status: StageStatus;
  /** Rows written so far while running. */
  done?: number;
  /** Rows written by the last successful run. */
  count?: number;
  error?: string;
  finishedAt?: number;
}

export interface SourceSyncState {
  isRunning: boolean;
  trigger?: SyncTrigger;
  stages: Partial<Record<SyncStage, StageState>>;
  lastFinishedAt?: number;
}

interface SyncStoreState {
  sources: Record<string, SourceSyncState>;
  forget: (sourceId: string) => void;
  beginRun: (sourceId: string, trigger: SyncTrigger) => void;
  setStage: (sourceId: string, stage: SyncStage, state: StageState) => void;
  endRun: (sourceId: string) => void;
}

const EMPTY: SourceSyncState = { isRunning: false, stages: {} };

/**
 * Live sync status per source — written only by sync-manager.ts, read by
 * anything that wants to show progress or a last error (a screen's
 * "syncing movies…" state, Home's footer in Phase 3). In memory only: what
 * survives a restart is each table's own sync_meta, which is what decides
 * whether a stage is due.
 */
export const useSyncStore = create<SyncStoreState>((set) => ({
  sources: {},
  forget: (sourceId) =>
    set((state) => {
      const { [sourceId]: _removed, ...rest } = state.sources;
      return { sources: rest };
    }),
  beginRun: (sourceId, trigger) =>
    set((state) => ({ sources: { ...state.sources, [sourceId]: { ...(state.sources[sourceId] ?? EMPTY), isRunning: true, trigger } } })),
  setStage: (sourceId, stage, stageState) =>
    set((state) => {
      const current = state.sources[sourceId] ?? EMPTY;
      return { sources: { ...state.sources, [sourceId]: { ...current, stages: { ...current.stages, [stage]: stageState } } } };
    }),
  endRun: (sourceId) =>
    set((state) => ({
      sources: { ...state.sources, [sourceId]: { ...(state.sources[sourceId] ?? EMPTY), isRunning: false, lastFinishedAt: Date.now() } },
    })),
}));

export function getSourceSyncState(sourceId: string): SourceSyncState {
  return useSyncStore.getState().sources[sourceId] ?? EMPTY;
}

/** One source's sync status, re-rendering only when it changes. */
export function useSourceSyncState(sourceId: string): SourceSyncState {
  return useSyncStore((state) => state.sources[sourceId] ?? EMPTY);
}

/** Test-only. */
export function __resetSyncStoreForTests(): void {
  useSyncStore.setState({ sources: {} });
}
