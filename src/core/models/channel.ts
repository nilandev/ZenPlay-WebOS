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
  /** Per-episode synopsis, when the provider includes one (Xtream's episode `info.plot`). */
  plot?: string;
  /** e.g. "2016-07-15", when the provider includes it — not parsed to a Date since some providers send partial/invalid values. */
  releaseDate?: string;
  /** 0-10 episode rating, when the provider includes one. */
  rating?: number;
}

/**
 * Rich series metadata beyond the browse-grid summary (name/poster/category)
 * — sourced from Xtream's get_series_info `info` block. Every field here is
 * optional: M3U sources never have any of it, and even Xtream providers
 * commonly leave individual fields (cast, rating, trailer, backdrop) empty
 * for less mainstream titles — see SeriesScreen's detail hero, which hides
 * each row rather than rendering it empty/"undefined".
 */
export interface SeriesDetails {
  plot?: string;
  cast?: string[];
  director?: string[];
  genre?: string[];
  /** e.g. "2016-07-15" — kept as a string; providers sometimes send partial/invalid dates that don't survive Date parsing. */
  releaseDate?: string;
  /** e.g. "2019-11-15" — most recently aired episode's date, when the provider tracks it. */
  lastAirDate?: string;
  /** 0-10, when the provider includes one. */
  rating?: number;
  /** Wide hero image distinct from the poster/cover — falls back to the poster in the UI when absent. */
  backdropUrl?: string;
  trailerUrl?: string;
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
