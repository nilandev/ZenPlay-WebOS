import { XtreamAuthError, XtreamClient, type PlaylistSource } from "@core";
import { bumpCacheVersion } from "../cache-invalidation-store.js";
import { catalogVersionKey, isCatalogSyncDue, syncCatalog } from "../catalog-sync.js";
import { clearCachedContentMatching, isCacheStale, loadCachedEntry, setCachedContent, type CacheKind } from "../content-cache.js";
import { loadLiveCategories, loadSeriesCategories, loadVodCategories } from "../content-loader.js";
import { EpgEmptyError } from "../epg-sync-core.js";
import { epgUrlFor, isEpgSyncDue, syncEpg } from "../epg-sync.js";
import { LiveEmptyError } from "../live-sync-core.js";
import { isLiveSyncDue, syncLiveChannels } from "../live-sync.js";
import { proxyFetch } from "../proxy-fetch.js";
import { withRetry } from "./retry.js";
import { CONTENT_STAGES, useSyncStore, type ContentStage, type StageState, type StageStatus, type SyncStage, type SyncTrigger } from "./sync-store.js";

/**
 * The one place that decides when a source's data is fetched. Everything
 * that used to start syncs on its own — App's profile-select revalidation,
 * VodScreen/SeriesScreen's catalog timers, the live and guide "if due"
 * checks — now asks this module (via sync-scheduler.ts, Home's Refresh, or
 * a screen that finds its table empty).
 *
 * A job runs a source's stages one at a time: sign-in (Xtream), then Live
 * TV, Series, Movies and the guide last (CONTENT_STAGES order, whatever
 * order the request listed them in). Each stage is skipped while its data is fresh unless
 * the request forces it, retried with backoff on failure, and reported to
 * sync-store.ts as it goes. One failing stage doesn't stop the others; a
 * failed sign-in stops the job, since every later stage would fail the same
 * way.
 *
 * There's never more than one job per source. A request that the running
 * job already covers just waits for it; one that needs more (a forced
 * refresh, or stages the running job isn't doing) runs as a follow-up right
 * after it, skipping any stage the running job synced after the request
 * was made — so a manual Refresh during a launch sync doesn't download
 * everything twice.
 */

/** Freshness of the account info (name/expiry) the sign-in stage refreshes. */
const ACCOUNT_INFO_KEY = (sourceId: string) => `playlist-info:${sourceId}`;
export interface SyncRequest {
  trigger: SyncTrigger;
  /** Content stages to consider; all of them when omitted. */
  stages?: ContentStage[];
  /** Run the stages even if their data is still fresh (manual Refresh). */
  force?: boolean;
}

export interface SyncOutcome {
  stages: Partial<Record<SyncStage, StageStatus>>;
  errors: Partial<Record<SyncStage, string>>;
}

interface FollowUp {
  source: PlaylistSource;
  stages: Set<ContentStage>;
  force: boolean;
  trigger: SyncTrigger;
  requestedAt: number;
  promise: Promise<SyncOutcome>;
  resolve: (outcome: SyncOutcome) => void;
}

interface Job {
  stages: ContentStage[];
  force: boolean;
  promise: Promise<SyncOutcome>;
  cancelled: boolean;
  /** When each stage finished syncing in this job — lets a follow-up skip what's already fresh. */
  syncedAt: Partial<Record<SyncStage, number>>;
  followUp?: FollowUp;
}

const jobs = new Map<string, Job>();

let retryConfig = { retries: 2, baseDelayMs: 2000 };

// --- Stage definitions -------------------------------------------------------

function appliesTo(source: PlaylistSource, stage: ContentStage): boolean {
  if (stage === "vod" || stage === "series") return source.kind === "xtream"; // an M3U's movies come with its live stage
  if (stage === "epg") return epgUrlFor(source) !== undefined;
  return true;
}

function isStageDue(source: PlaylistSource, stage: ContentStage): Promise<boolean> {
  if (stage === "live") return isLiveSyncDue(source);
  if (stage === "epg") return isEpgSyncDue(source);
  return isCatalogSyncDue(source.id, stage);
}

/** Refreshes a small cached list (categories) alongside its content stage. Best effort — the content is what matters. */
async function refreshCached(key: string, kind: CacheKind, load: () => Promise<unknown>): Promise<void> {
  try {
    setCachedContent(key, await load(), kind);
    bumpCacheVersion(key);
  } catch {
    // Screens refetch categories themselves when theirs are missing or stale.
  }
}

type Progress = (written: number) => void;

/** Each stage's work; resolves with how many rows it wrote, where that means something. */
const STAGE_RUNNERS: Record<SyncStage, (source: PlaylistSource, onProgress: Progress) => Promise<number | undefined>> = {
  async auth(source) {
    if (source.kind !== "xtream") return undefined;
    const { expiresAt } = await new XtreamClient(source, proxyFetch).getAccountInfo();
    setCachedContent(ACCOUNT_INFO_KEY(source.id), { name: source.name, expiresAt }, "playlist-info");
    bumpCacheVersion(ACCOUNT_INFO_KEY(source.id));
    return undefined;
  },
  async live(source, onProgress) {
    const result = await syncLiveChannels(source, { onProgress });
    if (source.kind === "xtream") {
      await refreshCached(`live-categories:${source.id}`, "category", () => loadLiveCategories(source));
    } else {
      // The same M3U download also filled the movie table (see live-sync-core.ts).
      clearCachedContentMatching((key) => key === `vod:${source.id}` || key.startsWith(`vod:${source.id}:cat:`));
      await refreshCached(`vod-categories:${source.id}`, "category", () => loadVodCategories(source));
      bumpCacheVersion(catalogVersionKey(source.id, "vod"));
    }
    return result.channelCount;
  },
  async vod(source, onProgress) {
    let written = 0;
    await syncCatalog(source, "vod", { onProgress: (n) => onProgress((written = n)) });
    await refreshCached(`vod-categories:${source.id}`, "category", () => loadVodCategories(source));
    return written;
  },
  async series(source, onProgress) {
    let written = 0;
    await syncCatalog(source, "series", { onProgress: (n) => onProgress((written = n)) });
    await refreshCached(`series-categories:${source.id}`, "category", () => loadSeriesCategories(source));
    return written;
  },
  async epg(source, onProgress) {
    const result = await syncEpg(source, { onProgress });
    return result?.programmeCount;
  },
};

/** Errors a retry can't fix: a rejected login, or a provider that answered with nothing. */
function isRetryable(err: unknown): boolean {
  return !(err instanceof XtreamAuthError || err instanceof LiveEmptyError || err instanceof EpgEmptyError);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- Jobs ---------------------------------------------------------------------

async function runJob(source: PlaylistSource, request: Required<SyncRequest>, job: Job): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { stages: {}, errors: {} };
  const report = (stage: SyncStage, state: StageState) => {
    outcome.stages[stage] = state.status;
    if (state.error) outcome.errors[stage] = state.error;
    else delete outcome.errors[stage];
    useSyncStore.getState().setStage(source.id, stage, state);
  };

  const runStage = async (stage: SyncStage): Promise<boolean> => {
    if (job.cancelled) {
      // Not a failure — nothing to report as an error (the source was switched away from, reset or removed).
      report(stage, { status: "skipped" });
      return false;
    }
    report(stage, { status: "running", done: 0 });
    try {
      const count = await withRetry(() => STAGE_RUNNERS[stage](source, (done) => report(stage, { status: "running", done })), {
        ...retryConfig,
        shouldRetry: isRetryable,
      });
      const finishedAt = Date.now();
      job.syncedAt[stage] = finishedAt;
      report(stage, { status: "synced", count, finishedAt });
      return true;
    } catch (err) {
      report(stage, { status: "failed", error: messageOf(err), finishedAt: Date.now() });
      return false;
    }
  };

  useSyncStore.getState().beginRun(source.id, request.trigger);
  try {
    const toRun: ContentStage[] = [];
    for (const stage of CONTENT_STAGES.filter((s) => request.stages.includes(s))) {
      if (!appliesTo(source, stage)) report(stage, { status: "not-applicable" });
      else if (request.force || (await isStageDue(source, stage))) {
        toRun.push(stage);
        report(stage, { status: "pending" });
      } else report(stage, { status: "fresh" });
    }

    if (source.kind === "xtream" && (toRun.length > 0 || request.force || (await isAccountInfoStale(source.id)))) {
      if (!(await runStage("auth"))) {
        const reason = outcome.errors.auth ?? "Couldn't sign in";
        for (const stage of toRun) report(stage, { status: "skipped", error: reason });
        return outcome;
      }
    }

    for (const stage of toRun) await runStage(stage);
    return outcome;
  } finally {
    useSyncStore.getState().endRun(source.id);
  }
}

async function isAccountInfoStale(sourceId: string): Promise<boolean> {
  await loadCachedEntry(ACCOUNT_INFO_KEY(sourceId));
  return isCacheStale(ACCOUNT_INFO_KEY(sourceId));
}

function startJob(source: PlaylistSource, request: Required<SyncRequest>): Promise<SyncOutcome> {
  const job: Job = { stages: request.stages, force: request.force, cancelled: false, syncedAt: {}, promise: undefined as unknown as Promise<SyncOutcome> };
  job.promise = runJob(source, request, job).then((outcome) => {
    jobs.delete(source.id);
    const followUp = job.followUp;
    if (followUp) {
      const remaining = [...followUp.stages].filter((stage) => (job.syncedAt[stage] ?? -Infinity) < followUp.requestedAt);
      if (job.cancelled || remaining.length === 0) followUp.resolve(outcome);
      else void startJob(followUp.source, { stages: remaining, force: followUp.force, trigger: followUp.trigger }).then(followUp.resolve);
    }
    return outcome;
  });
  jobs.set(source.id, job);
  return job.promise;
}

/**
 * Syncs a source's stale (or, with `force`, all requested) stages. Never
 * rejects — every failure is reported per stage in the outcome and in
 * sync-store.ts.
 */
export function syncSource(source: PlaylistSource, request: SyncRequest): Promise<SyncOutcome> {
  const full: Required<SyncRequest> = { trigger: request.trigger, stages: request.stages ?? CONTENT_STAGES, force: request.force ?? false };
  const running = jobs.get(source.id);
  if (!running) return startJob(source, full);

  const covered = !full.force && full.stages.every((stage) => running.stages.includes(stage));
  if (covered) return running.promise;

  if (!running.followUp) {
    let resolve!: (outcome: SyncOutcome) => void;
    const promise = new Promise<SyncOutcome>((r) => (resolve = r));
    running.followUp = { source, stages: new Set(), force: false, trigger: full.trigger, requestedAt: Date.now(), promise, resolve };
  }
  const followUp = running.followUp;
  followUp.source = source;
  for (const stage of full.stages) followUp.stages.add(stage);
  followUp.force ||= full.force;
  if (full.force) followUp.trigger = full.trigger;
  return followUp.promise;
}

/**
 * Stops a source's running job after its current stage(s) — used when the
 * active source changes. Work already handed to a worker finishes (and
 * writes only its own source's rows); nothing after it starts, and any
 * queued follow-up is dropped.
 */
export function cancelSync(sourceId: string): void {
  const job = jobs.get(sourceId);
  if (job) job.cancelled = true;
}

/** Resolves once the source has no running job (including any follow-up it queued) — never rejects. */
export async function whenIdle(sourceId: string): Promise<void> {
  for (let job = jobs.get(sourceId); job; job = jobs.get(sourceId)) {
    await job.promise;
    if (job.followUp) await job.followUp.promise;
  }
}

export function isSyncRunning(sourceId: string): boolean {
  return jobs.has(sourceId);
}

/** Test-only. */
export function __resetSyncManagerForTests(options: { retries?: number; baseDelayMs?: number } = {}): void {
  jobs.clear();
  retryConfig = { retries: options.retries ?? 2, baseDelayMs: options.baseDelayMs ?? 2000 };
}
