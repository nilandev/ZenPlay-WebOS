import type { Channel, ChannelGuide, ContinueWatchingEntry, FavoriteEntry, SeriesInfo } from "@core";

/**
 * Curation heuristics for Home's hero and fallback shelves. There is no
 * server-side "trending"/"popular"/"featured" signal on a standard Xtream
 * panel — everything here is a client-side proxy built from data the app
 * already has cached (no new fetches), not real analytics. Kept in one
 * module and named accordingly (recentlyAdded, not "trending") so a future
 * reader doesn't mistake these for a real ranking signal.
 */

export type HeroCandidateKind = "continue-watching" | "live-now" | "recently-added";

export interface HeroCandidate {
  kind: HeroCandidateKind;
  contentKind: "movie" | "series" | "live";
  /** Bare stream id — same id space as Channel.id/SeriesInfo.id. */
  id: string;
  title: string;
  backdropUrl?: string;
  /** Only set for kind: "live-now" — the programme currently airing. */
  nowPlayingTitle?: string;
}

/**
 * Channel/category names matched case-insensitively as a substring against
 * Channel.name/groupTitle to guess "this is worth highlighting live" —
 * there's no genre/category field on EpgProgramme itself (see
 * core/models/epg.ts) to key off instead. A deliberately small, easy-to-edit
 * allowlist rather than an attempt at real classification.
 */
const LIVE_HIGHLIGHT_KEYWORDS = ["sport", "espn", "sky sports", "bein", "news", "24/7"];

function isHighlightWorthy(channel: Pick<Channel, "name" | "groupTitle">): boolean {
  const haystack = `${channel.name} ${channel.groupTitle ?? ""}`.toLowerCase();
  return LIVE_HIGHLIGHT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Picks one hero candidate, in priority order: the most recently updated
 * in-progress Continue Watching item, else a live channel currently airing
 * something that matches LIVE_HIGHLIGHT_KEYWORDS, else the first item of
 * `recentVod` as a "featured" stand-in. Returns null only when every input
 * is empty — callers render the branded fallback banner in that case (see
 * Hero.tsx), never an empty/broken hero.
 */
export function pickHeroCandidate(params: {
  continueWatching: ContinueWatchingEntry[];
  continueWatchingContent: Map<string, { title: string; backdropUrl?: string }>;
  liveChannels: Channel[];
  epgGuides: Map<string, ChannelGuide>;
  recentVod: Channel[];
}): HeroCandidate | null {
  const { continueWatching, continueWatchingContent, liveChannels, epgGuides, recentVod } = params;

  const latestContinueWatching = [...continueWatching].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
  if (latestContinueWatching) {
    const content = continueWatchingContent.get(latestContinueWatching.contentId);
    if (content) {
      return {
        kind: "continue-watching",
        contentKind: latestContinueWatching.contentKind === "movie" ? "movie" : "series",
        id: latestContinueWatching.contentId,
        title: content.title,
        backdropUrl: content.backdropUrl,
      };
    }
  }

  for (const channel of liveChannels) {
    if (!isHighlightWorthy(channel)) continue;
    const guide = epgGuides.get(channel.epgChannelId ?? channel.id);
    const now = guide?.getNowNext().now;
    if (!now) continue;
    return {
      kind: "live-now",
      contentKind: "live",
      id: channel.id,
      title: channel.name,
      backdropUrl: channel.logoUrl,
      nowPlayingTitle: now.title,
    };
  }

  const featured = recentVod[0];
  if (featured) {
    return {
      kind: "recently-added",
      contentKind: "movie",
      id: featured.id,
      title: featured.name,
      backdropUrl: featured.logoUrl,
    };
  }

  return null;
}

/**
 * Up to `count` hero candidates for the hero's auto-cycle rotation (see
 * Hero.tsx) — same priority ordering as pickHeroCandidate but returns
 * several instead of stopping at the first match.
 */
export function pickHeroRotation(
  params: Parameters<typeof pickHeroCandidate>[0],
  count = 5,
): HeroCandidate[] {
  const { continueWatching, continueWatchingContent, liveChannels, epgGuides, recentVod } = params;
  const candidates: HeroCandidate[] = [];

  for (const entry of [...continueWatching].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())) {
    const content = continueWatchingContent.get(entry.contentId);
    if (!content) continue;
    candidates.push({
      kind: "continue-watching",
      contentKind: entry.contentKind === "movie" ? "movie" : "series",
      id: entry.contentId,
      title: content.title,
      backdropUrl: content.backdropUrl,
    });
    if (candidates.length >= count) return candidates;
  }

  for (const channel of liveChannels) {
    if (!isHighlightWorthy(channel)) continue;
    const guide = epgGuides.get(channel.epgChannelId ?? channel.id);
    const now = guide?.getNowNext().now;
    if (!now) continue;
    candidates.push({
      kind: "live-now",
      contentKind: "live",
      id: channel.id,
      title: channel.name,
      backdropUrl: channel.logoUrl,
      nowPlayingTitle: now.title,
    });
    if (candidates.length >= count) return candidates;
  }

  for (const item of recentVod) {
    candidates.push({ kind: "recently-added", contentKind: "movie", id: item.id, title: item.name, backdropUrl: item.logoUrl });
    if (candidates.length >= count) return candidates;
  }

  return candidates;
}

/**
 * Day-1 fallback for a "Recently Added" shelf when there's no watch
 * history yet — just the first page of the local VOD catalog, which
 * catalog-db.ts already returns newest-synced-first. Not a real "trending"
 * signal (see module doc comment).
 */
export function pickRecentlyAdded(vodPage: Channel[]): Channel[] {
  return vodPage;
}

/**
 * Resolves a profile's favourite entries into displayable summaries via the
 * given lookup maps (built by the caller from catalog-store.ts's
 * getRecordsByIds + content-cache.ts's live channel list — see
 * HomeScreen.tsx). Entries whose content couldn't be resolved (removed from
 * the provider) are silently dropped, matching Scenario C's "collapse, don't
 * error" requirement.
 */
export function resolveFavorites(
  favorites: FavoriteEntry[],
  content: Map<string, { title: string; imageUrl?: string }>,
): Array<{ entry: FavoriteEntry; title: string; imageUrl?: string }> {
  const resolved: Array<{ entry: FavoriteEntry; title: string; imageUrl?: string }> = [];
  for (const entry of favorites) {
    const found = content.get(entry.contentId);
    if (found) resolved.push({ entry, title: found.title, imageUrl: found.imageUrl });
  }
  return resolved;
}

export function seriesToContentSummary(series: Pick<SeriesInfo, "id" | "name" | "posterUrl">): { title: string; backdropUrl?: string } {
  return { title: series.name, backdropUrl: series.posterUrl };
}

export function channelToContentSummary(channel: Pick<Channel, "name" | "logoUrl">): { title: string; backdropUrl?: string } {
  return { title: channel.name, backdropUrl: channel.logoUrl };
}
