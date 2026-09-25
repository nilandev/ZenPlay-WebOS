import { useEffect, useMemo, useState } from "react";
import {
  buildKidsRails,
  getDefaultKidsRules,
  type Category,
  type Channel,
  type KidsContentKind,
  type KidsTag,
  type PlaylistSource,
  type Profile,
  type Rail,
  type RecHistoryEntry,
  type RecItem,
  type WatchHistoryEntry,
} from "@core";
import { getCatalogPage, getRecordsByIds } from "./catalog-store.js";
import { MORE_FOR_KIDS_CATEGORY_ID, PARENT_PICKS_CATEGORY_ID, type ContentPolicy } from "./content-policy.js";
import { getLocalChannelProgrammes } from "./epg-store.js";
import { loadWatchHistory } from "./profile-store.js";
import { useCatalogCategories, useKidsAllowedKeys } from "./use-kids-allowed.js";
import { usePolicyLiveChannels } from "./use-policy-live-channels.js";

/** What a Kids Home card does when chosen — exactly one is set. */
export interface KidsHomeItem extends RecItem {
  subtitle?: string;
  progress?: number;
  /** Continue Watching: resume this history entry. */
  historyEntry?: WatchHistoryEntry;
  /** A film to play. */
  movie?: Channel;
  /** A live channel to tune. */
  channel?: Channel;
}

/** Allowed categories sampled per kind for the tag and "Because you watched" rails — enough to fill them without querying every category. */
const MAX_CATEGORIES_PER_KIND = 10;
const SAMPLE_PER_CATEGORY = 12;
const LIVE_RAIL_SIZE = 20;

const toKidsKind = (kind: WatchHistoryEntry["kind"]): KidsContentKind => (kind === "movie" ? "vod" : kind);
/** Category ids are only unique within one kind — the rail engine sees them prefixed. */
const categoryKey = (kind: KidsContentKind, categoryId: string | undefined) => (categoryId ? `${kind}:${categoryId}` : undefined);

function mergeTags(...lists: KidsTag[][]): KidsTag[] {
  return Array.from(new Set(lists.flat()));
}

/**
 * Gathers what a Kids profile may see and orders it into the Kids Home
 * rails (docs/kids-profile.md §3.5, ranking in core/kids/recommend.ts):
 * allowed history, the parent's picks, samples of the allowed categories,
 * and allowed live channels with what's on now. Local reads only.
 */
export function useKidsHomeRails(source: PlaylistSource, profile: Profile, policy: ContentPolicy, refreshKey: number): { rails: Array<Rail<KidsHomeItem>>; isLoading: boolean } {
  const fullHistory = useMemo(() => {
    void refreshKey;
    return loadWatchHistory(profile.id, source.id);
  }, [profile.id, source.id, refreshKey]);
  const historyItems = useMemo(() => fullHistory.map((e) => ({ kind: e.kind, id: e.contentId })), [fullHistory]);
  const allowedKeys = useKidsAllowedKeys(source, policy, historyItems);
  const history = useMemo(() => (allowedKeys ? fullHistory.filter((e) => allowedKeys.has(`${e.kind}:${e.contentId}`)) : fullHistory), [fullHistory, allowedKeys]);

  const { channels } = usePolicyLiveChannels(source, policy);
  const vodCategories = useCatalogCategories(source, "vod", true);
  const seriesCategories = useCatalogCategories(source, "series", true);
  const categoriesByKind = useMemo<Record<KidsContentKind, Category[]>>(() => ({ vod: vodCategories, series: seriesCategories, live: [] }), [vodCategories, seriesCategories]);

  const [catalog, setCatalog] = useState<{ picks: KidsHomeItem[]; byCategory: Map<string, KidsHomeItem[]> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const rules = getDefaultKidsRules();
    void (async () => {
      const byCategory = new Map<string, KidsHomeItem[]>();
      const picks: KidsHomeItem[] = [];
      for (const kind of ["vod", "series"] as const) {
        const categories = categoriesByKind[kind];
        const filter = policy.catalogFilter(kind, categories);
        const byId = new Map(categories.map((c) => [c.id, c]));
        const allowed = policy
          .visibleCatalogCategories(kind, categories)
          .filter((c) => c.id !== PARENT_PICKS_CATEGORY_ID && c.id !== MORE_FOR_KIDS_CATEGORY_ID)
          .slice(0, MAX_CATEGORIES_PER_KIND);
        const pages = await Promise.all(
          allowed.map((category) => getCatalogPage(source.id, kind as "vod", { categoryId: category.id, offset: 0, limit: SAMPLE_PER_CATEGORY, filter }).catch(() => [])),
        );
        allowed.forEach((category, index) => {
          const categoryTags = policy.categoryState(kind, category).tags;
          byCategory.set(
            categoryKey(kind, category.id)!,
            pages[index].map((item) => ({
              kind,
              id: item.id,
              name: item.name,
              imageUrl: item.logoUrl ?? (item as { posterUrl?: string }).posterUrl,
              categoryId: categoryKey(kind, category.id),
              tags: mergeTags(categoryTags, rules.tagText(item.name).tags),
              movie: kind === "vod" ? item : undefined,
            })),
          );
        });
        const pickIds = policy.parentPickIds(kind);
        if (pickIds.length > 0) {
          const records = await getRecordsByIds(source.id, kind as "vod", pickIds).catch(() => []);
          for (const item of records) {
            const category = item.groupTitle ? byId.get(item.groupTitle) : undefined;
            picks.push({
              kind,
              id: item.id,
              name: item.name,
              imageUrl: item.logoUrl ?? (item as { posterUrl?: string }).posterUrl,
              categoryId: categoryKey(kind, item.groupTitle),
              tags: mergeTags(category ? policy.categoryState(kind, category).tags : [], rules.tagText(item.name).tags),
              movie: kind === "vod" ? item : undefined,
            });
          }
        }
      }
      if (!cancelled) setCatalog({ picks, byCategory });
    })();
    return () => {
      cancelled = true;
    };
  }, [source.id, policy, categoriesByKind]);

  // What's on now for the first allowed channels — the Kids Live Now rail's subtitles.
  const liveChannels = useMemo(() => channels.slice(0, LIVE_RAIL_SIZE), [channels]);
  const [nowTitles, setNowTitles] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    void Promise.all(liveChannels.map((c) => getLocalChannelProgrammes(source.id, c.epgChannelId ?? c.id))).then((guides) => {
      if (cancelled) return;
      const titles = new Map<string, string>();
      guides.forEach((programmes, index) => {
        const current = programmes?.find((p) => p.start.getTime() <= now && now < p.stop.getTime());
        if (current) titles.set(liveChannels[index].id, current.title);
      });
      setNowTitles(titles);
    });
    return () => {
      cancelled = true;
    };
  }, [source.id, liveChannels]);

  const rails = useMemo(() => {
    if (!catalog) return [];
    const rules = getDefaultKidsRules();
    const categoryTagsOf = (kind: KidsContentKind, categoryId: string | undefined): KidsTag[] => {
      if (!categoryId) return [];
      const category = categoriesByKind[kind].find((c) => c.id === categoryId);
      return category ? policy.categoryState(kind, category).tags : [];
    };
    const recHistory: RecHistoryEntry[] = history.map((entry) => {
      const kind = toKidsKind(entry.kind);
      const completion = entry.finished ? 1 : entry.kind === "live" ? 0.5 : entry.durationSeconds ? (entry.positionSeconds ?? 0) / entry.durationSeconds : 0.25;
      return {
        kind,
        id: entry.contentId,
        title: entry.title,
        categoryId: categoryKey(kind, entry.categoryId),
        tags: mergeTags(categoryTagsOf(kind, entry.categoryId), rules.tagText(entry.title).tags),
        updatedAt: entry.updatedAt,
        completion,
        finished: Boolean(entry.finished),
      };
    });
    const continueWatching: KidsHomeItem[] = history
      .filter((entry) => entry.kind !== "live" && !entry.finished)
      .map((entry) => ({
        kind: toKidsKind(entry.kind),
        id: entry.contentId,
        name: entry.title,
        subtitle: entry.subtitle,
        imageUrl: entry.imageUrl,
        categoryId: categoryKey(toKidsKind(entry.kind), entry.categoryId),
        tags: [],
        progress: entry.durationSeconds ? Math.min(1, Math.max(0, (entry.positionSeconds ?? 0) / entry.durationSeconds)) : undefined,
        historyEntry: entry,
      }));
    const livePicks = new Set(policy.parentPickIds("live"));
    const toLiveItem = (channel: Channel): KidsHomeItem => ({
      kind: "live",
      id: channel.id,
      name: channel.name,
      subtitle: nowTitles.get(channel.id),
      imageUrl: channel.logoUrl,
      categoryId: categoryKey("live", channel.groupTitle),
      tags: [],
      channel,
    });
    return buildKidsRails<KidsHomeItem>({
      now: Date.now(),
      history: recHistory,
      continueWatching,
      parentPicks: [...catalog.picks, ...channels.filter((c) => livePicks.has(c.id)).map(toLiveItem)],
      byCategory: catalog.byCategory,
      liveNow: liveChannels.map(toLiveItem),
    });
  }, [catalog, history, channels, liveChannels, nowTitles, policy, categoriesByKind]);

  return { rails, isLoading: catalog === null };
}
