export interface Profile {
  id: string;
  name: string;
  /** Path under public/avatar (e.g. "avatar/toon_1.png") chosen from AVATAR_CHOICES at creation. */
  avatarUrl: string;
  favoriteChannelIds: string[];
}

/**
 * The fixed set of avatar images users pick from at profile creation — see
 * public/avatar/. Deliberately root-relative without a leading slash (not
 * "/avatar/...") to match Vite's `base: "./"` (see vite.config.ts): webOS TV
 * loads the packaged app from its own local directory rather than a server
 * root, so a leading-slash path 404s there even though it works under
 * `vite dev`, which happens to serve everything from "/" regardless.
 */
export const AVATAR_CHOICES: string[] = Array.from({ length: 10 }, (_, i) => `avatar/toon_${i + 1}.png`);

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
