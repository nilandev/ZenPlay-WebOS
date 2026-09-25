import { KIDS_RULES_VERSION, mapLiveStream, parseM3u, type Channel, type PlaylistSource, type XtreamLiveStreamRaw } from "@core";
import { catalogSyncMetaKey, deleteStaleGeneration, getSyncMeta, openCatalogDb, putRecordsBatch, putSyncMeta } from "./core/storage/catalog-db.js";
import { deleteStaleChannels, getLiveSyncMeta, openLiveDb, putChannels, putLiveSyncMeta, type LiveChannelRecord, type LiveDb } from "./core/storage/live-db.js";
import { channelToRecord, UNGROUPED_CATEGORY } from "./catalog-records.js";
import { SyncStorageUnavailableError, type SyncJobOptions } from "./sync-job.js";

/**
 * The live channel sync — fetch a source's whole live list (Xtream
 * get_live_streams, or the M3U playlist), parse and map it, and write it
 * into the live table (core/storage/live-db.ts) in batches. DOM-free: it
 * normally runs inside src/workers/sync-worker.ts, so the JSON.parse/M3U
 * parse of a 20k-channel list never touches the main thread.
 *
 * Write-then-swap like epg-sync-core.ts: rows are keyed by list position, so
 * a re-sync overwrites positions in place under a new generation, flips
 * sync_meta, then sweeps the older generation (positions past the new end).
 *
 * An M3U playlist is one file holding live channels and movies together,
 * so its movies are written to the VOD catalog table (catalog-db.ts) from
 * the same download and parse — M3U has no separate VOD API for
 * catalog-sync.ts to call, and parsing the file twice would mean
 * downloading it twice.
 */

export interface LiveSyncRequest {
  source: PlaylistSource;
}

export interface LiveSyncResult {
  channelCount: number;
  /** M3U only: movies written to the VOD catalog table from the same playlist. */
  movieCount?: number;
}

/** The provider returned no live channels at all — kept separate so a good list isn't wiped by an empty/broken response. */
export class LiveEmptyError extends Error {
  constructor() {
    super("The provider returned no live channels.");
    this.name = "LiveEmptyError";
  }
}

export const DEFAULT_LIVE_BATCH_SIZE = 2000;

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

interface FetchedPlaylist {
  live: Channel[];
  /** Present for M3U sources only — see the module doc comment. */
  movies?: Channel[];
}

async function fetchPlaylist(source: PlaylistSource, fetchImpl: typeof fetch): Promise<FetchedPlaylist> {
  if (source.kind !== "xtream") {
    let content: string;
    if (source.kind === "m3u-file") {
      content = source.content;
    } else {
      const response = await fetchImpl(source.url);
      if (!response.ok) throw new Error(`Playlist request failed: HTTP ${response.status}`);
      content = await response.text();
    }
    const entries = parseM3u(content);
    return {
      live: entries.filter((c) => c.kind === "live"),
      movies: entries.filter((c) => c.kind === "movie").map((c) => (c.groupTitle ? c : { ...c, groupTitle: UNGROUPED_CATEGORY })),
    };
  }

  const url = new URL(`${stripTrailingSlash(source.baseUrl)}/player_api.php`);
  url.searchParams.set("username", source.username);
  url.searchParams.set("password", source.password);
  url.searchParams.set("action", "get_live_streams");
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`Xtream request failed: HTTP ${response.status}`);
  const raw = (await response.json()) as unknown;
  // A panel that rejects the login answers with an object, not a list.
  if (!Array.isArray(raw)) throw new Error("The provider didn't return a channel list.");
  return { live: (raw as XtreamLiveStreamRaw[]).map((s) => mapLiveStream(source, s)) };
}

/** Writes an M3U playlist's movies into the VOD catalog table, with catalog-sync.ts's own write-then-swap (integer generations there). */
async function writeMovies(sourceId: string, movies: Channel[], batchSize: number, yieldBetweenBatches?: () => Promise<void>): Promise<void> {
  const catalogDb = await openCatalogDb();
  const key = catalogSyncMetaKey(sourceId, "vod");
  const previous = await getSyncMeta(catalogDb, key);
  const generation = (previous?.generation ?? 0) + 1;
  for (let offset = 0; offset < movies.length; offset += batchSize) {
    await putRecordsBatch(catalogDb, "vod", movies.slice(offset, offset + batchSize).map((movie) => channelToRecord(sourceId, generation, movie)));
    if (yieldBetweenBatches) await yieldBetweenBatches();
  }
  await putSyncMeta(catalogDb, { key, lastSyncedAt: Date.now(), recordCount: movies.length, generation, rulesVersion: KIDS_RULES_VERSION });
  if (previous) await deleteStaleGeneration(catalogDb, "vod", sourceId, generation);
}

export async function runLiveSync(request: LiveSyncRequest, options: SyncJobOptions): Promise<LiveSyncResult> {
  const { source } = request;
  const { fetchImpl, onProgress, batchSize = DEFAULT_LIVE_BATCH_SIZE, yieldBetweenBatches } = options;

  let liveDb: LiveDb;
  try {
    liveDb = await openLiveDb();
  } catch (err) {
    throw new SyncStorageUnavailableError(err);
  }

  const previous = await getLiveSyncMeta(liveDb, source.id);
  const { live: channels, movies } = await fetchPlaylist(source, fetchImpl);
  // An M3U with movies but no live channels is a valid (VOD-only) playlist; only a response with nothing at all is suspect.
  if (channels.length === 0 && !movies?.length && previous) throw new LiveEmptyError();

  // Time-based for the same reason as epg-sync-core.ts: a partial, unrecorded sync must never share a generation with a later one.
  const generation = Math.max(Date.now(), (previous?.generation ?? 0) + 1);

  for (let offset = 0; offset < channels.length; offset += batchSize) {
    const records: LiveChannelRecord[] = channels
      .slice(offset, offset + batchSize)
      .map((channel, i) => ({ ...channel, sourceId: source.id, position: offset + i, generation }));
    await putChannels(liveDb, records);
    onProgress?.(offset + records.length);
    if (yieldBetweenBatches) await yieldBetweenBatches();
  }

  await putLiveSyncMeta(liveDb, { sourceId: source.id, lastSyncedAt: Date.now(), generation, channelCount: channels.length });
  await deleteStaleChannels(liveDb, source.id, generation);

  if (movies) await writeMovies(source.id, movies, batchSize, yieldBetweenBatches);
  return movies ? { channelCount: channels.length, movieCount: movies.length } : { channelCount: channels.length };
}
