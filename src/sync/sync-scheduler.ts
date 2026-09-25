import type { PlaylistSource } from "@core";
import { cancelSync, syncSource } from "./sync-manager.js";
import { getSourceSyncState, type SyncTrigger } from "./sync-store.js";

export interface SyncSchedulerOptions {
  /** Wait after start before the launch sync, so the splash and Home's first focus aren't competing with it. */
  launchDelayMs?: number;
  /** How often a visible app checks for stale stages. */
  intervalMs?: number;
  /** A return to the foreground only syncs if the app was hidden at least this long. */
  resumeAfterMs?: number;
}

const DEFAULTS: Required<SyncSchedulerOptions> = {
  launchDelayMs: 3000,
  intervalMs: 30 * 60 * 1000,
  resumeAfterMs: 30 * 60 * 1000,
};

/**
 * Keeps the active source's data fresh without anyone asking: a launch sync
 * shortly after start, a check every `intervalMs` while the app is visible,
 * a sync when the TV brings the app back after a long time in the
 * background (visibilitychange, and webOS's relaunch event), and a retry of
 * failed stages when the network comes back. Every trigger goes through
 * sync-manager.ts, so each only syncs stages that are actually stale (and
 * overlapping triggers share one job).
 *
 * Started by App for the active source once a profile is chosen. The
 * returned stop function removes every timer and listener and cancels the
 * source's running job — which is how switching sources stops the old one.
 */
export function startSyncScheduler(source: PlaylistSource, options: SyncSchedulerOptions = {}): () => void {
  const { launchDelayMs, intervalMs, resumeAfterMs } = { ...DEFAULTS, ...options };
  const run = (trigger: SyncTrigger) => void syncSource(source, { trigger });

  const launchTimer = setTimeout(() => run("launch"), launchDelayMs);
  const interval = setInterval(() => {
    if (document.visibilityState !== "hidden") run("interval");
  }, intervalMs);

  let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  const onReturn = () => {
    if (hiddenAt !== null && Date.now() - hiddenAt >= resumeAfterMs) run("resume");
    hiddenAt = null;
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") hiddenAt ??= Date.now();
    else onReturn();
  };
  const onOnline = () => {
    const { stages } = getSourceSyncState(source.id);
    if (Object.values(stages).some((stage) => stage?.status === "failed" || stage?.status === "skipped")) run("online");
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  // webOS fires this when the user relaunches an app that was already running in the background.
  document.addEventListener("webOSRelaunch", onReturn);
  window.addEventListener("online", onOnline);

  return () => {
    clearTimeout(launchTimer);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("webOSRelaunch", onReturn);
    window.removeEventListener("online", onOnline);
    cancelSync(source.id);
  };
}
