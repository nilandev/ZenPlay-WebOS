import { useEffect, useState } from "react";
import type { PlaylistSource } from "@core";
import { catalogSyncMetaKey, getSyncMeta, openCatalogDb } from "../core/storage/catalog-db.js";
import { getLocalEpgMeta } from "../epg-store.js";
import { epgUrlFor } from "../epg-sync.js";
import { getLocalLiveMeta } from "../live-store.js";
import { useSourceSyncState, type SourceSyncState, type SyncStage } from "./sync-store.js";

/**
 * What's stored for a source, from each table's own sync record — the
 * durable counterpart to sync-store.ts's in-memory "what's happening now".
 * Backs "Updated 2h ago · 12,430 channels" on Home and Manage Playlists.
 */
export interface SourceSyncSummary {
  /** The oldest of the source's synced tables — everything is at least this fresh. null when nothing has synced yet. */
  lastSyncedAt: number | null;
  channels?: number;
  movies?: number;
  series?: number;
  programmes?: number;
}

const EMPTY_SUMMARY: SourceSyncSummary = { lastSyncedAt: null };

export async function readSyncSummary(source: PlaylistSource): Promise<SourceSyncSummary> {
  try {
    const catalogDb = await openCatalogDb();
    const [live, vod, series, epg] = await Promise.all([
      getLocalLiveMeta(source.id),
      getSyncMeta(catalogDb, catalogSyncMetaKey(source.id, "vod")),
      source.kind === "xtream" ? getSyncMeta(catalogDb, catalogSyncMetaKey(source.id, "series")) : Promise.resolve(undefined),
      epgUrlFor(source) ? getLocalEpgMeta(source.id) : Promise.resolve(undefined),
    ]);
    const times = [live?.lastSyncedAt, vod?.lastSyncedAt, series?.lastSyncedAt, epg?.lastSyncedAt].filter((t): t is number => t !== undefined);
    return {
      lastSyncedAt: times.length > 0 ? Math.min(...times) : null,
      channels: live?.channelCount,
      movies: vod?.recordCount,
      series: series?.recordCount,
      programmes: epg?.programmeCount,
    };
  } catch {
    return EMPTY_SUMMARY;
  }
}

/** A source's summary, re-read whenever one of its syncs finishes. */
export function useSyncSummary(source: PlaylistSource): SourceSyncSummary {
  const { lastFinishedAt } = useSourceSyncState(source.id);
  const [summary, setSummary] = useState<SourceSyncSummary>(EMPTY_SUMMARY);
  useEffect(() => {
    let cancelled = false;
    void readSyncSummary(source).then((next) => {
      if (!cancelled) setSummary(next);
    });
    return () => {
      cancelled = true;
    };
  }, [source, lastFinishedAt]);
  return summary;
}

// --- Wording ---------------------------------------------------------------------

const STAGE_LABELS: Record<SyncStage, string> = {
  auth: "Signing in",
  live: "Channels",
  vod: "Movies",
  series: "Series",
  epg: "TV guide",
};

export function stageLabel(stage: SyncStage, source?: PlaylistSource): string {
  // An M3U's movies arrive with its channels (see live-sync-core.ts).
  if (stage === "live" && source && source.kind !== "xtream") return "Channels & movies";
  return STAGE_LABELS[stage];
}

/** "just now", "5 min ago", "2h ago", "3 days ago". */
export function formatSyncedAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** A generic "Sync in progress…" while the source syncs, or null when it isn't — no per-stage names or counts. */
export function describeRunningSync(state: SourceSyncState): string | null {
  return state.isRunning ? "Sync in progress…" : null;
}

/** The stages the last run failed or skipped, with the first error — null when it went fine. */
export function describeSyncFailure(state: SourceSyncState, source?: PlaylistSource): { stages: SyncStage[]; message: string } | null {
  if (state.isRunning) return null;
  const failed = (Object.entries(state.stages) as Array<[SyncStage, SourceSyncState["stages"][SyncStage]]>).filter(
    ([, stage]) => stage?.status === "failed" || (stage?.status === "skipped" && stage.error !== undefined),
  );
  if (failed.length === 0) return null;
  const stages = failed.map(([stage]) => stage);
  const error = failed.find(([, stage]) => stage?.error)?.[1]?.error ?? "The provider didn't respond.";
  // A failed sign-in skips everything after it, so its error says it all; otherwise name what failed.
  if (stages.includes("auth")) return { stages, message: error };
  return { stages, message: `${stages.map((stage) => stageLabel(stage, source)).join(", ")}: ${error}` };
}

/** "12,430 channels · 48,210 movies · 3,100 series" — only what's known. */
export function formatCounts(summary: SourceSyncSummary): string {
  const parts: string[] = [];
  if (summary.channels !== undefined) parts.push(`${summary.channels.toLocaleString()} channels`);
  if (summary.movies !== undefined) parts.push(`${summary.movies.toLocaleString()} movies`);
  if (summary.series !== undefined) parts.push(`${summary.series.toLocaleString()} series`);
  return parts.join(" · ");
}
