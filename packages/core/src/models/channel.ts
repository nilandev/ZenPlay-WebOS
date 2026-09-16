export type StreamKind = "live" | "movie" | "series";

export interface Channel {
  id: string;
  name: string;
  logoUrl?: string;
  groupTitle?: string;
  streamUrl: string;
  epgChannelId?: string;
  kind: StreamKind;
  /** Present when the provider (Xtream) exposes catch-up/archive for this channel. */
  hasArchive?: boolean;
  archiveDurationDays?: number;
}

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  season: number;
  episode: number;
  title: string;
  streamUrl: string;
  posterUrl?: string;
  durationSeconds?: number;
}

export interface SeriesInfo {
  id: string;
  name: string;
  posterUrl?: string;
  groupTitle?: string;
  episodes: SeriesEpisode[];
}

export interface Category {
  id: string;
  name: string;
  kind: StreamKind;
}
