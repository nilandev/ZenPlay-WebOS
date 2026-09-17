export interface Profile {
  id: string;
  name: string;
  avatarEmoji: string;
  isKidsProfile: boolean;
  /** SHA-256 hex digest of the parental PIN, never the raw PIN. Absent = no lock. */
  pinHash?: string;
  lockedCategoryIds: string[];
  favoriteChannelIds: string[];
}

export interface ContinueWatchingEntry {
  profileId: string;
  contentId: string;
  contentKind: "movie" | "series-episode";
  /** For series-episode, the episode's own id; contentId is the parent series id. */
  episodeId?: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}
