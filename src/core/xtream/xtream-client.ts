import type { Category, Channel, SeriesEpisode, SeriesInfo } from "../models/channel.js";
import type { XtreamCredentials } from "../models/playlist-source.js";

interface XtreamAuthResponse {
  user_info: {
    auth: number;
    status: string;
    username: string;
  };
  server_info: {
    url: string;
    port: string;
    https_port: string;
  };
}

interface XtreamLiveStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  epg_channel_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number;
}

interface XtreamVodStream {
  stream_id: number;
  name: string;
  stream_icon?: string;
  category_id?: string;
  container_extension?: string;
}

interface XtreamSeries {
  series_id: number;
  name: string;
  cover?: string;
  category_id?: string;
}

interface XtreamCategory {
  category_id: string;
  category_name: string;
}

interface XtreamSeriesInfoResponse {
  episodes: Record<
    string,
    Array<{
      id: string;
      title: string;
      container_extension: string;
      episode_num: number;
      season: number;
      info?: { movie_image?: string; duration_secs?: number };
    }>
  >;
}

export class XtreamAuthError extends Error {
  constructor(message = "Xtream authentication failed") {
    super(message);
    this.name = "XtreamAuthError";
  }
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

  private async fetchJson<T>(params: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(this.buildApiUrl(params));
    if (!response.ok) {
      throw new Error(`Xtream request failed: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async authenticate(): Promise<XtreamAuthResponse> {
    const result = await this.fetchJson<XtreamAuthResponse>({});
    if (!result.user_info || result.user_info.auth !== 1) {
      throw new XtreamAuthError();
    }
    return result;
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
    const raw = await this.fetchJson<XtreamLiveStream[]>(params);
    return raw.map((s) => ({
      id: String(s.stream_id),
      name: s.name,
      logoUrl: s.stream_icon,
      groupTitle: s.category_id,
      epgChannelId: s.epg_channel_id,
      streamUrl: this.buildStreamUrl("live", s.stream_id, "m3u8"),
      kind: "live" as const,
      hasArchive: s.tv_archive === 1,
      archiveDurationDays: s.tv_archive_duration,
    }));
  }

  async getVodStreams(categoryId?: string): Promise<Channel[]> {
    const params: Record<string, string> = { action: "get_vod_streams" };
    if (categoryId) params.category_id = categoryId;
    const raw = await this.fetchJson<XtreamVodStream[]>(params);
    return raw.map((s) => ({
      id: String(s.stream_id),
      name: s.name,
      logoUrl: s.stream_icon,
      groupTitle: s.category_id,
      streamUrl: this.buildStreamUrl("movie", s.stream_id, s.container_extension || "mp4"),
      kind: "movie" as const,
    }));
  }

  async getSeriesList(categoryId?: string): Promise<Array<Pick<SeriesInfo, "id" | "name" | "posterUrl" | "groupTitle">>> {
    const params: Record<string, string> = { action: "get_series" };
    if (categoryId) params.category_id = categoryId;
    const raw = await this.fetchJson<XtreamSeries[]>(params);
    return raw.map((s) => ({
      id: String(s.series_id),
      name: s.name,
      posterUrl: s.cover,
      groupTitle: s.category_id,
    }));
  }

  async getSeriesInfo(seriesId: string): Promise<SeriesEpisode[]> {
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
          title: ep.title,
          posterUrl: ep.info?.movie_image,
          durationSeconds: ep.info?.duration_secs,
          streamUrl: this.buildStreamUrl("series", Number(ep.id), ep.container_extension || "mp4"),
        });
      }
    }
    return episodes;
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

  private buildStreamUrl(kind: "live" | "movie" | "series", streamId: number, extension: string): string {
    const base = this.stripTrailingSlash(this.credentials.baseUrl);
    return `${base}/${kind}/${this.credentials.username}/${this.credentials.password}/${streamId}.${extension}`;
  }
}
