import type { Category, Channel, MovieDetails, SeriesDetails, SeriesEpisode, SeriesInfo } from "../models/channel.js";
import type { EpgProgramme } from "../models/epg.js";
import type { XtreamCredentials } from "../models/playlist-source.js";
import { cleanTitle } from "../text/clean-title.js";
import {
  buildXtreamStreamUrl,
  mapEpgListing,
  mapLiveStream,
  mapSeriesEntry,
  mapVodStream,
  type XtreamEpgListingRaw,
  type XtreamLiveStreamRaw,
  type XtreamSeriesRaw,
  type XtreamVodStreamRaw,
} from "./xtream-mappers.js";

interface XtreamAuthResponse {
  user_info: {
    auth: number;
    status: string;
    username: string;
    /** Unix seconds as a string, or null/"0" for an account with no expiry ("Unlimited"). */
    exp_date: string | null;
    /** Streams currently open on this account — panels send it as a string ("0") or a number. */
    active_cons?: string | number;
    /** Concurrent streams the account allows; "0"/missing means unlimited. */
    max_connections?: string | number;
  };
  server_info: {
    url: string;
    port: string;
    https_port: string;
  };
}

export interface XtreamAccountInfo {
  /** Provider's account status — "Active", "Banned", "Disabled" or "Expired" on standard panels. */
  status: string;
  /** null when the account has no expiry ("Unlimited"). */
  expiresAt: Date | null;
  /** null when the panel doesn't report it. */
  activeConnections: number | null;
  /** null when the panel doesn't report it or the account is unlimited. */
  maxConnections: number | null;
}

function toCount(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

interface XtreamCategory {
  category_id: string;
  category_name: string;
}

interface XtreamSeriesInfoResponse {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    /** Some panels send this key instead of releaseDate. */
    release_date?: string;
    last_modified?: string;
    /** 0-10 as a string, sometimes "0" or "" when the provider has no rating. */
    rating?: string;
    /** Usually a single-element array; some panels send a bare string instead. */
    backdrop_path?: string[] | string;
    youtube_trailer?: string;
  };
  episodes: Record<
    string,
    Array<{
      id: string;
      title: string;
      container_extension: string;
      episode_num: number;
      season: number;
      info?: { movie_image?: string; duration_secs?: number; plot?: string; releasedate?: string; rating?: string | number };
    }>
  >;
}

interface XtreamVodInfoResponse {
  info?: {
    plot?: string;
    description?: string;
    genre?: string;
    releasedate?: string;
    release_date?: string;
    rating?: string | number;
    /** Usually an array; some panels send a bare string. */
    backdrop_path?: string[] | string;
    duration_secs?: number;
  };
}

/** Splits a provider's comma-separated field (cast, genre, director) into trimmed, non-empty entries. */
function splitList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/** Parses a provider rating string ("8.4", "0", "") into a number, treating 0/blank/NaN as "no rating" rather than a real zero score. */
function parseRating(value?: string | number): number | undefined {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export class XtreamAuthError extends Error {
  constructor(message = "Xtream authentication failed") {
    super(message);
    this.name = "XtreamAuthError";
  }
}

/**
 * Short-lived cache of in-flight/just-settled player_api.php calls, keyed by
 * playlist source id + the exact request params, and shared across every
 * XtreamClient instance for that source (screens each construct their own
 * client per call — see content-loader.ts — so this can't just be
 * per-instance state).
 *
 * Exists to collapse bursts of near-simultaneous, identical requests that
 * happen on first load: HomeScreen fires four independent live/movies/
 * series/playlist-info loads in parallel, each authenticating from scratch,
 * and switching straight into a content tab (e.g. Series from the home CTA)
 * repeats several of the same get_series/get_series_categories/
 * get_live_streams/get_vod_streams calls Home already made — all competing
 * for the same connection to a provider that can already be slow, which is
 * what made a fresh session's first navigation feel stuck (see conversation
 * history). REQUEST_DEDUPE_MS is short (not a real cache — get_series etc.
 * still need to reflect provider-side catalog changes within a session) so
 * it only catches calls that are genuinely concurrent, not later revisits;
 * see content-cache.ts's much longer-lived STALE_AFTER_MS for the
 * screen-level "instant tab-switch" cache this complements.
 */
const REQUEST_DEDUPE_MS = 3000;
const requestCache = new Map<string, { promise: Promise<unknown>; cachedAt: number }>();

/** Test-only escape hatch: clears the module-level request dedupe cache so each test starts with a clean slate instead of reusing a previous test's mocked response for the same source id + params. */
export function __resetRequestDedupeCacheForTests(): void {
  requestCache.clear();
}

/**
 * Thin client for the Xtream Codes `player_api.php` protocol.
 * Kept dependency-free (fetch only) so it runs unmodified both in a plain
 * browser during dev and inside webOS TV's WebKit runtime, which provides
 * global fetch.
 *
 * Accepts an optional fetch implementation so a host app can route requests
 * through its own transport — e.g. a same-origin dev proxy to sidestep
 * browser CORS when a provider doesn't send Access-Control-Allow-Origin
 * (see src/proxy-fetch.ts) — without this package needing to know
 * anything about that concern itself.
 */
export class XtreamClient {
  constructor(
    private readonly credentials: XtreamCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private buildApiUrl(params: Record<string, string>): string {
    const url = new URL(`${this.stripTrailingSlash(this.credentials.baseUrl)}/player_api.php`);
    url.searchParams.set("username", this.credentials.username);
    url.searchParams.set("password", this.credentials.password);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private stripTrailingSlash(url: string): string {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  }

  private requestCacheKey(params: Record<string, string>): string {
    return `${this.credentials.id}:${JSON.stringify(Object.entries(params).sort())}`;
  }

  /**
   * Fetches one player_api.php action, deduped against any identical
   * (same source + same params) call still within REQUEST_DEDUPE_MS —
   * see requestCache's doc comment for why. Keyed on the params rather
   * than the full URL so it dedupes correctly regardless of key ordering
   * or which XtreamClient instance issues the call.
   */
  private async fetchJson<T>(params: Record<string, string>): Promise<T> {
    const cacheKey = this.requestCacheKey(params);
    const cached = requestCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < REQUEST_DEDUPE_MS) {
      return cached.promise as Promise<T>;
    }

    const promise = this.performFetchJson<T>(params);
    requestCache.set(cacheKey, { promise, cachedAt: Date.now() });
    // A failed request shouldn't keep poisoning the dedupe window for the
    // rest of its lifetime — drop it immediately so the next call (e.g.
    // after a transient network blip, or the user fixing bad credentials)
    // gets a real retry instead of the same rejected promise replayed
    // until REQUEST_DEDUPE_MS elapses. This only catches an HTTP-level/
    // network failure (performFetchJson's own throw) — a *successful*
    // response that some caller then decides represents a semantic failure
    // (e.g. authenticate()'s auth !== 1 check below) needs to evict the
    // cache itself, since fetchJson has no way to know that a 200 response
    // shaped like {"user_info":{"auth":0}} isn't perfectly cacheable data.
    promise.catch(() => requestCache.delete(cacheKey));
    return promise;
  }

  private async performFetchJson<T>(params: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(this.buildApiUrl(params));
    // Panels answer bad credentials with HTTP 401 ({"error":"INVALID_AUTH"}) rather than a 200 with auth: 0 — same meaning, so same error.
    if (response.status === 401) throw new XtreamAuthError();
    if (!response.ok) {
      throw new Error(`Xtream request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async authenticate(): Promise<XtreamAuthResponse> {
    const params = {};
    const result = await this.fetchJson<XtreamAuthResponse>(params);
    if (!result.user_info || result.user_info.auth !== 1) {
      // See fetchJson's comment: a failed login is a valid, successfully
      // fetched response, not something its own generic failure-eviction
      // catches — without evicting it here too, a user retrying right after
      // fixing bad credentials would keep getting this same rejected
      // dedupe-window entry replayed instead of a fresh authentication.
      requestCache.delete(this.requestCacheKey(params));
      throw new XtreamAuthError();
    }
    return result;
  }

  /** Account status + expiry, e.g. for a "playlist expires on X" footer. Re-authenticates rather than caching, since expiry can change server-side. */
  async getAccountInfo(): Promise<XtreamAccountInfo> {
    const { user_info } = await this.authenticate();
    const expSeconds = user_info.exp_date ? Number(user_info.exp_date) : 0;
    const maxConnections = toCount(user_info.max_connections);
    return {
      status: user_info.status,
      expiresAt: expSeconds > 0 ? new Date(expSeconds * 1000) : null,
      activeConnections: toCount(user_info.active_cons),
      maxConnections: maxConnections === 0 ? null : maxConnections,
    };
  }

  async getLiveCategories(): Promise<Category[]> {
    const raw = await this.fetchJson<XtreamCategory[]>({ action: "get_live_categories" });
    return raw.map((c) => ({ id: c.category_id, name: c.category_name, kind: "live" as const }));
  }

  async getVodCategories(): Promise<Category[]> {
    const raw = await this.fetchJson<XtreamCategory[]>({ action: "get_vod_categories" });
    return raw.map((c) => ({ id: c.category_id, name: c.category_name, kind: "movie" as const }));
  }

  async getSeriesCategories(): Promise<Category[]> {
    const raw = await this.fetchJson<XtreamCategory[]>({ action: "get_series_categories" });
    return raw.map((c) => ({ id: c.category_id, name: c.category_name, kind: "series" as const }));
  }

  async getLiveChannels(categoryId?: string): Promise<Channel[]> {
    const params: Record<string, string> = { action: "get_live_streams" };
    if (categoryId) params.category_id = categoryId;
    const raw = await this.fetchJson<XtreamLiveStreamRaw[]>(params);
    return raw.map((s) => mapLiveStream(this.credentials, s));
  }

  async getVodStreams(categoryId?: string): Promise<Channel[]> {
    const params: Record<string, string> = { action: "get_vod_streams" };
    if (categoryId) params.category_id = categoryId;
    const raw = await this.fetchJson<XtreamVodStreamRaw[]>(params);
    return raw.map((s) => mapVodStream(this.credentials, s));
  }

  async getSeriesList(categoryId?: string): Promise<Array<Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle" | "genre">>> {
    const params: Record<string, string> = { action: "get_series" };
    if (categoryId) params.category_id = categoryId;
    const raw = await this.fetchJson<XtreamSeriesRaw[]>(params);
    return raw.map(mapSeriesEntry);
  }

  /**
   * Single get_series_info round-trip, returning both the episode list and
   * the series-level metadata (plot/cast/genre/rating/backdrop) the same
   * response carries — see SeriesDetails' doc comment for why every detail
   * field is optional.
   */
  async getSeriesDetails(seriesId: string): Promise<{ details: SeriesDetails; episodes: SeriesEpisode[] }> {
    const raw = await this.fetchJson<XtreamSeriesInfoResponse>({
      action: "get_series_info",
      series_id: seriesId,
    });

    const episodes: SeriesEpisode[] = [];
    for (const [, seasonEpisodes] of Object.entries(raw.episodes ?? {})) {
      for (const ep of seasonEpisodes) {
        episodes.push({
          id: ep.id,
          seriesId,
          season: ep.season,
          episode: ep.episode_num,
          title: cleanTitle(ep.title),
          posterUrl: ep.info?.movie_image,
          durationSeconds: ep.info?.duration_secs,
          plot: ep.info?.plot,
          releaseDate: ep.info?.releasedate,
          rating: parseRating(ep.info?.rating),
          streamUrl: buildXtreamStreamUrl(this.credentials, "series", Number(ep.id), ep.container_extension || "mp4"),
        });
      }
    }

    const info = raw.info;
    const backdrop = Array.isArray(info?.backdrop_path) ? info.backdrop_path[0] : info?.backdrop_path;
    const details: SeriesDetails = {
      plot: info?.plot || undefined,
      cast: splitList(info?.cast),
      director: splitList(info?.director),
      genre: splitList(info?.genre),
      releaseDate: info?.releaseDate || info?.release_date || undefined,
      lastAirDate: info?.last_modified || undefined,
      rating: parseRating(info?.rating),
      backdropUrl: backdrop || undefined,
      trailerUrl: info?.youtube_trailer || undefined,
    };

    return { details, episodes };
  }

  /** A film's plot, rating, release date and backdrop (get_vod_info). Missing fields stay undefined. */
  async getVodDetails(vodId: string): Promise<MovieDetails> {
    const raw = await this.fetchJson<XtreamVodInfoResponse>({ action: "get_vod_info", vod_id: vodId });
    const info = raw.info;
    const backdrop = Array.isArray(info?.backdrop_path) ? info.backdrop_path[0] : info?.backdrop_path;
    return {
      plot: info?.plot || info?.description || undefined,
      genre: splitList(info?.genre),
      releaseDate: info?.releasedate || info?.release_date || undefined,
      rating: parseRating(info?.rating),
      backdropUrl: backdrop || undefined,
      durationSeconds: info?.duration_secs || undefined,
    };
  }

  /** @deprecated Use getSeriesDetails, which also returns series-level metadata from the same response. Kept for any caller that only wants the flat episode list. */
  async getSeriesInfo(seriesId: string): Promise<SeriesEpisode[]> {
    const { episodes } = await this.getSeriesDetails(seriesId);
    return episodes;
  }

  /**
   * Per-stream EPG listings (typically the current day, provider-dependent
   * how far ahead/behind it covers) — distinct from xmltv.php's bulk export
   * (see content-loader.ts's loadEpg), which some panels either omit
   * entirely or keep out of sync with what get_epg itself returns for a
   * given stream_id. Returns [] rather than throwing on a provider that
   * doesn't support the action, since an empty guide for one channel
   * shouldn't be a hard error for the whole screen.
   */
  async getShortEpg(streamId: string): Promise<EpgProgramme[]> {
    const raw = await this.fetchJson<{ epg_listings?: XtreamEpgListingRaw[] }>({
      action: "get_epg",
      stream_id: streamId,
    });
    return (raw.epg_listings ?? []).map(mapEpgListing);
  }

  /** Archive/catch-up playback URL for a given epoch-second start time and duration in minutes. */
  buildCatchupUrl(streamId: string, startUnixSeconds: number, durationMinutes: number): string {
    const base = this.stripTrailingSlash(this.credentials.baseUrl);
    return `${base}/streaming/timeshift.php?username=${encodeURIComponent(
      this.credentials.username,
    )}&password=${encodeURIComponent(
      this.credentials.password,
    )}&stream=${streamId}&start=${startUnixSeconds}&duration=${durationMinutes}`;
  }
}
