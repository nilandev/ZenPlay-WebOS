import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isKidsProfile, type Channel, type PlaylistSource, type Profile, type SeriesEpisode, type WatchHistoryEntry } from "@core";
import {
  addPlaylistSource,
  forgetProfileSource,
  getActivePlaylistSourceId,
  loadPlaylistSources,
  playlistForProfile,
  rememberProfileSource,
  removePlaylistSource,
  setActivePlaylistSourceId,
} from "./playlist-store.js";
import {
  addProfile,
  clearActiveProfile,
  deleteProfile,
  getActiveProfileId,
  loadProfiles,
  setActiveProfileId,
  updateProfile,
  getResumePoint,
  type ResumePoint,
} from "./profile-store.js";
import { MeshBackground, SyncPill, Toast } from "@ui";
import { useContentPolicy } from "./content-policy.js";
import { useMatureNowChannelIds } from "./use-policy-live-channels.js";
import { getLocalLiveMeta } from "./live-store.js";
import { liveStreamUrl } from "./live-stream-url.js";
import { purgeSourceData } from "./sync/purge.js";
import { startSyncScheduler } from "./sync/sync-scheduler.js";
import { useSourceSyncState } from "./sync/sync-store.js";
import { describeRunningSync } from "./sync/sync-summary.js";
import { FirstSyncScreen } from "./screens/FirstSyncScreen.js";
import { loadMovieDetails, loadSeriesDetails } from "./content-loader.js";
import type { ChannelLineup } from "./channel-lineup.js";
import type { WatchTarget } from "./use-watch-history-recorder.js";
import { AddSourceScreen } from "./screens/AddSourceScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { KidsHomeScreen } from "./screens/KidsHomeScreen.js";
import { LiveTvScreen } from "./screens/LiveTvScreen.js";
import { VodScreen } from "./screens/VodScreen.js";
import { SeriesScreen, type EpisodePlayContext } from "./screens/SeriesScreen.js";
import { yearFromDate, type PlaybackInfo } from "./screens/PlayerOverlays.js";
import { GuideScreen } from "./screens/GuideScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { FavouritesScreen } from "./screens/FavouritesScreen.js";
import { HistoryScreen } from "./screens/HistoryScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { ManageProfilesScreen } from "./screens/ManageProfilesScreen.js";
import { PlayerScreen, type PlaybackIdentity } from "./screens/PlayerScreen.js";
import { detectPlatform } from "./platform.js";

const TABS = [
  { id: "home", label: "Home" },
  { id: "live", label: "Live TV" },
  { id: "guide", label: "Guide" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "favourites", label: "My Favourite" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The episode that should play after `current`, in season/episode order —
 * not necessarily adjacent in `allEpisodes` (SeriesScreen passes its raw,
 * unsorted episode list). Returns null at the end of the series, which
 * PlayerScreen treats as "no Next Episode control".
 */
function findNextEpisode(current: SeriesEpisode, allEpisodes: SeriesEpisode[]): SeriesEpisode | null {
  const sorted = [...allEpisodes].sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = sorted.findIndex((ep) => ep.id === current.id);
  if (index === -1) return null;
  return sorted[index + 1] ?? null;
}

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(), []);
  const [sources, setSources] = useState<PlaylistSource[]>(() => loadPlaylistSources());
  const [activeSourceId, setActiveSourceIdState] = useState<string | null>(() => getActivePlaylistSourceId());
  const activeSource = sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null;

  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [isManagingProfiles, setIsManagingProfiles] = useState(false);
  // "Who's watching?" was opened from a Kids profile — picking a parent profile then needs the PIN (docs/kids-profile.md §2.3).
  const [isLeavingKids, setIsLeavingKids] = useState(false);
  // Shown when a Kids profile's live channel was stopped because what's on turned mature (§3.6).
  const [kidsNotice, setKidsNotice] = useState<string | null>(null);
  const dismissKidsNotice = useCallback(() => setKidsNotice(null), []);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const playbackUrlRef = useRef(playbackUrl);
  playbackUrlRef.current = playbackUrl;
  const [playbackIdentity, setPlaybackIdentity] = useState<PlaybackIdentity | undefined>(undefined);
  const [playbackTitle, setPlaybackTitle] = useState<string | undefined>(undefined);
  const [playbackSubtitle, setPlaybackSubtitle] = useState<string | undefined>(undefined);
  const [playbackResume, setPlaybackResume] = useState<ResumePoint | null>(null);
  const [playbackAutoResume, setPlaybackAutoResume] = useState(false);
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo | undefined>(undefined);
  const [playbackEpisodeId, setPlaybackEpisodeId] = useState<string | undefined>(undefined);
  const [playbackChannel, setPlaybackChannel] = useState<Channel | undefined>(undefined);
  // What's playing, for Recently Watched (see use-watch-history-recorder.ts).
  const [watchTarget, setWatchTarget] = useState<WatchTarget | undefined>(undefined);
  // Where a live channel was started from — what CH+/CH− and number keys can reach in the player.
  const [channelLineup, setChannelLineup] = useState<ChannelLineup | null>(null);
  // The series around the episode playing — kept so Next Episode and the
  // player's Episodes panel can start another episode with the same context.
  const [seriesContext, setSeriesContext] = useState<EpisodePlayContext>({});
  // The episode after the one currently playing, computed when a series
  // episode starts (see playEpisode) — null when there isn't one (last
  // episode of the last season, or a movie), which is what tells
  // PlayerScreen to hide the Next Episode control entirely.
  const [nextEpisode, setNextEpisode] = useState<SeriesEpisode | null>(null);
  // Live TV/catch-up-at-live-edge playback shows a "LIVE" badge and hides
  // the seek bar in PlayerScreen — see PlaybackControls' isLive prop.
  const [isPlaybackLive, setIsPlaybackLive] = useState(false);
  // Kept alongside nextEpisode purely so onNextEpisode (below) can compute
  // *its* next episode in turn without SeriesScreen re-supplying the list —
  // playing through a series advances this same array each time.
  const [seriesEpisodes, setSeriesEpisodes] = useState<SeriesEpisode[]>([]);
  // Set when navigating to Series from a favourited series (My Favourite),
  // so SeriesScreen opens straight into that series' episode list instead
  // of its shelf browser. Cleared once SeriesScreen mounts with it.
  const [pendingSeriesId, setPendingSeriesId] = useState<string | null>(null);
  // Mirrors SeriesScreen's own "which series is open" state up here, since
  // switching tabs unmounts SeriesScreen and discards its local state —
  // without this, leaving Series mid-episode-list and coming back would
  // always drop the user back at the shelf browser instead of where they
  // left off. Reported via SeriesScreen's onSelectionChange.
  const [seriesSelectionId, setSeriesSelectionId] = useState<string | null>(null);
  // Bumped every time playback closes, so SeriesScreen/VodScreen can re-read
  // Continue Watching (upsertContinueWatching persists to localStorage
  // during playback, which isn't itself reactive state — same shape as the
  // favoritesVersion pattern those screens already use for favourites).
  const [playbackCloseVersion, setPlaybackCloseVersion] = useState(0);
  // Bumped every time the player closes (live too), so Recently Watched re-reads what was just watched.
  const [historyVersion, setHistoryVersion] = useState(0);

  // What the active profile may see — everything for a standard profile, the Kids whitelist for a Kids profile.
  const policy = useContentPolicy(activeProfile, activeSource?.id);
  const isKids = isKidsProfile(activeProfile);

  // Kids + live: re-check the playing channel and its lineup against what's on
  // now. CH+/CH− skip channels airing something mature, and the playing channel
  // stops if its programme turns mature (docs/kids-profile.md §3.6).
  const guardedChannels = useMemo(() => {
    const list = channelLineup?.lineup ?? [];
    return playbackChannel && !list.some((c) => c.id === playbackChannel.id) ? [...list, playbackChannel] : list;
  }, [channelLineup, playbackChannel]);
  const matureNowIds = useMatureNowChannelIds(activeSource?.id ?? "", guardedChannels, isKids && isPlaybackLive && guardedChannels.length > 0);
  const playerLineup = useMemo(() => {
    if (!channelLineup || matureNowIds.size === 0) return channelLineup;
    return {
      lineup: channelLineup.lineup.filter((c) => !matureNowIds.has(c.id)),
      directory: channelLineup.directory.filter((c) => !matureNowIds.has(c.id)),
    };
  }, [channelLineup, matureNowIds]);
  // Settings (playlists, reset data, Parental Controls) doesn't exist in a Kids profile.
  useEffect(() => {
    if (isKids && activeTab === "settings") setActiveTab("home");
  }, [isKids, activeTab]);
  const closePlaybackRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isKids || !isPlaybackLive || !playbackChannel || !matureNowIds.has(playbackChannel.id)) return;
    closePlaybackRef.current();
    setKidsNotice("This show isn't available right now — pick another channel.");
  }, [isKids, isPlaybackLive, playbackChannel, matureNowIds]);

  /** Makes `profile` the active one, switching to the playlist it last used (see playlist-store's per-profile memory). */
  function activateProfile(profile: Profile): void {
    const remembered = playlistForProfile(profile.id, sources);
    if (remembered && remembered !== activeSourceId) {
      setActivePlaylistSourceId(remembered);
      setActiveSourceIdState(remembered);
    }
    setActiveProfile(profile);
  }

  useEffect(() => {
    const savedId = getActiveProfileId();
    const saved = savedId ? profiles.find((p) => p.id === savedId) : undefined;
    if (saved) activateProfile(saved);
    // Only re-check localStorage-persisted active profile once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whatever playlist the active profile ends up on — picked on Home,
  // switched in Settings, or newly added — is the one it opens on next time.
  useEffect(() => {
    if (activeProfile && activeSource) rememberProfileSource(activeProfile.id, activeSource.id);
  }, [activeProfile, activeSource]);

  // Keeps the active source's data fresh — a launch sync a few seconds in,
  // then on an interval, on return from the background and when the network
  // comes back (see sync/sync-scheduler.ts). Everything downloads and parses
  // in the sync worker, so none of it stalls Home's remote input. Keyed on
  // the source id: switching sources stops (and cancels) the old scheduler.
  const hasActiveProfile = activeProfile !== null;
  const activeSourceRef = useRef(activeSource);
  activeSourceRef.current = activeSource;
  useEffect(() => {
    const source = activeSourceRef.current;
    if (!source || !hasActiveProfile) return;
    return startSyncScheduler(source);
  }, [activeSource?.id, hasActiveProfile]);

  // Whether each source still needs its first download, which gets its own
  // screen (FirstSyncScreen) instead of dropping the user onto empty tabs.
  // "done" once its live channels have synced before, or the user continued.
  const [firstSyncBySource, setFirstSyncBySource] = useState<Record<string, "checking" | "needed" | "done">>({});
  const activeSourceId_ = activeSource?.id;
  useEffect(() => {
    if (!activeSourceId_ || firstSyncBySource[activeSourceId_]) return;
    setFirstSyncBySource((prev) => ({ ...prev, [activeSourceId_]: "checking" }));
    void getLocalLiveMeta(activeSourceId_).then((meta) => setFirstSyncBySource((prev) => ({ ...prev, [activeSourceId_]: meta ? "done" : "needed" })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId_]);

  // Home shows a small corner badge while the active source syncs in the background; the browse screens keep showing what's stored meanwhile.
  const activeSyncState = useSourceSyncState(activeSource?.id ?? "");
  const syncPillLabel = activeSource ? describeRunningSync(activeSyncState) : null;

  function handleSourceAdded(source: PlaylistSource): void {
    const updated = addPlaylistSource(source);
    setSources(updated);
    setActivePlaylistSourceId(source.id);
    setActiveSourceIdState(source.id);
  }

  function handleRemoveSource(sourceId: string): void {
    // Everything stored for it goes too — downloaded data and every profile's favourites/history (see sync/purge.ts).
    void purgeSourceData(sourceId);
    const updated = removePlaylistSource(sourceId);
    setSources(updated);
    if (activeSourceId === sourceId) {
      const fallback = updated[0] ?? null;
      if (fallback) {
        setActivePlaylistSourceId(fallback.id);
        setActiveSourceIdState(fallback.id);
      } else {
        setActiveSourceIdState(null);
      }
    }
  }

  function handleSetActiveSource(sourceId: string): void {
    setActivePlaylistSourceId(sourceId);
    setActiveSourceIdState(sourceId);
  }

  function handleCreateProfile(profile: Profile): void {
    setIsLeavingKids(false);
    const updated = addProfile(profile);
    setProfiles(updated);
    setActiveProfile(profile);
    setActiveProfileId(profile.id);
  }

  function handleSelectProfile(profile: Profile): void {
    setIsLeavingKids(false);
    activateProfile(profile);
    setActiveProfileId(profile.id);
  }

  function handleUpdateAnyProfile(profileId: string, patch: Partial<Profile>): void {
    setProfiles(updateProfile(profileId, patch));
  }

  function handleDeleteProfile(profileId: string): void {
    setProfiles(deleteProfile(profileId));
    forgetProfileSource(profileId);
    if (getActiveProfileId() === profileId) clearActiveProfile();
  }

  if (!activeSource) {
    return <AddSourceScreen onSourceAdded={handleSourceAdded} platform={platform} />;
  }

  if (!activeProfile) {
    if (isManagingProfiles) {
      return (
        <ManageProfilesScreen
          profiles={profiles}
          platform={platform}
          onBack={() => setIsManagingProfiles(false)}
          onUpdateProfile={handleUpdateAnyProfile}
          onDeleteProfile={handleDeleteProfile}
        />
      );
    }
    return (
      <ProfilesScreen
        profiles={profiles}
        platform={platform}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
        onManageProfiles={() => setIsManagingProfiles(true)}
        isLeavingKids={isLeavingKids}
      />
    );
  }

  const firstSync = firstSyncBySource[activeSource.id];
  if (firstSync === undefined || firstSync === "checking") {
    // A few milliseconds while IndexedDB answers — blank rather than a flash of Home before the first-sync screen.
    return <MeshBackground>{null}</MeshBackground>;
  }
  if (firstSync === "needed") {
    return (
      <FirstSyncScreen
        source={activeSource}
        platform={platform}
        onContinue={() => setFirstSyncBySource((prev) => ({ ...prev, [activeSource.id]: "done" }))}
      />
    );
  }

  // Continue Watching identity helpers — defined here (rather than above)
  // so they can close over activeProfile once it's narrowed non-null by the
  // guard above; live TV/catch-up playback skips identity entirely since
  // Continue Watching doesn't apply to it.
  // options.resume: the viewer already chose to continue (Recently Watched) — no Resume/Start Over prompt.
  const playMovie = (movie: Channel, options: { resume?: boolean } = {}): void => {
    setPlaybackChannel(undefined);
    setPlaybackIdentity({ profileId: activeProfile.id, contentId: movie.id, contentKind: "movie" });
    setPlaybackResume(getResumePoint(activeProfile.id, movie.id));
    setPlaybackAutoResume(Boolean(options.resume));
    setWatchTarget({
      profileId: activeProfile.id,
      sourceId: activeSource.id,
      kind: "movie",
      contentId: movie.id,
      title: movie.name,
      imageUrl: movie.logoUrl,
      streamUrl: movie.streamUrl,
      categoryId: movie.groupTitle,
    });
    setPlaybackEpisodeId(undefined);
    setPlaybackInfo({ posterUrl: movie.logoUrl });
    // Plot/rating/year/backdrop arrive a moment later (Xtream get_vod_info);
    // only applied if this film is still the one playing.
    const streamUrl = movie.streamUrl;
    void loadMovieDetails(activeSource, movie.id).then((details) => {
      if (playbackUrlRef.current !== streamUrl) return;
      setPlaybackInfo({
        posterUrl: movie.logoUrl,
        backdropUrl: details.backdropUrl,
        plot: details.plot,
        rating: details.rating,
        year: yearFromDate(details.releaseDate),
      });
    });
    setPlaybackTitle(movie.name);
    setPlaybackSubtitle(undefined);
    setNextEpisode(null);
    setIsPlaybackLive(false);
    setPlaybackUrl(movie.streamUrl);
  };
  // allEpisodes is every episode of the series across all seasons (see
  // SeriesScreen's onPlayEpisode) — used to find the episode immediately
  // after this one for the player's Next Episode control, without this
  // component needing its own copy of season/episode-ordering logic.
  const playEpisode = (episode: SeriesEpisode, allEpisodes: SeriesEpisode[], context: EpisodePlayContext = seriesContext): void => {
    setPlaybackChannel(undefined);
    setPlaybackIdentity({
      profileId: activeProfile.id,
      contentId: episode.seriesId,
      contentKind: "series-episode",
      episodeId: episode.id,
    });
    setPlaybackResume(getResumePoint(activeProfile.id, episode.seriesId, episode.id));
    setPlaybackAutoResume(Boolean(context.resume));
    setSeriesContext({ ...context, resume: false });
    setPlaybackEpisodeId(episode.id);
    // Netflix-style: the series is the title, the episode goes underneath.
    setPlaybackTitle(context.seriesName ?? episode.title);
    setPlaybackSubtitle(context.seriesName ? `S${episode.season} E${episode.episode} · ${episode.title}` : `S${episode.season} E${episode.episode}`);
    setPlaybackInfo({
      posterUrl: context.posterUrl ?? episode.posterUrl,
      backdropUrl: context.details?.backdropUrl ?? episode.posterUrl,
      plot: episode.plot ?? context.details?.plot,
      rating: episode.rating ?? context.details?.rating,
      year: yearFromDate(episode.releaseDate ?? context.details?.releaseDate),
    });
    const next = findNextEpisode(episode, allEpisodes);
    const episodeLine = (ep: SeriesEpisode) => `S${ep.season} E${ep.episode} · ${ep.title}`;
    setWatchTarget({
      profileId: activeProfile.id,
      sourceId: activeSource.id,
      kind: "series",
      contentId: episode.seriesId,
      title: context.seriesName ?? episode.title,
      subtitle: episodeLine(episode),
      imageUrl: context.posterUrl ?? episode.posterUrl,
      streamUrl: episode.streamUrl,
      episodeId: episode.id,
      season: episode.season,
      episode: episode.episode,
      categoryId: context.categoryId,
      nextEpisode: next
        ? { episodeId: next.id, season: next.season, episode: next.episode, subtitle: `Up next: ${episodeLine(next)}`, streamUrl: next.streamUrl }
        : undefined,
    });
    setNextEpisode(next);
    setSeriesEpisodes(allEpisodes);
    setIsPlaybackLive(false);
    setPlaybackUrl(episode.streamUrl);
  };
  const playWithoutIdentity = (streamUrl: string): void => {
    setPlaybackChannel(undefined);
    setWatchTarget(undefined); // catch-up isn't recorded
    setPlaybackIdentity(undefined);
    setPlaybackResume(null);
    setPlaybackAutoResume(false);
    setPlaybackEpisodeId(undefined);
    setPlaybackInfo(undefined);
    setPlaybackTitle(undefined);
    setPlaybackSubtitle(undefined);
    setNextEpisode(null);
    setIsPlaybackLive(false);
    setPlaybackUrl(streamUrl);
  };
  const playLive = (channel: Channel, lineup?: ChannelLineup): void => {
    if (lineup) setChannelLineup(lineup); // a channel change inside the player keeps the lineup
    setPlaybackIdentity(undefined);
    setPlaybackResume(null);
    setPlaybackAutoResume(false);
    setPlaybackEpisodeId(undefined);
    setPlaybackInfo({ logoUrl: channel.logoUrl });
    setPlaybackChannel(channel);
    setWatchTarget({
      profileId: activeProfile.id,
      sourceId: activeSource.id,
      kind: "live",
      contentId: channel.id,
      title: channel.name,
      imageUrl: channel.logoUrl,
      streamUrl: channel.streamUrl,
      channelNumber: channel.number,
      categoryId: channel.groupTitle,
    });
    setPlaybackTitle(channel.name);
    setPlaybackSubtitle(undefined);
    setNextEpisode(null);
    setIsPlaybackLive(true);
    // In the Live Stream Format from App Settings, or on Auto the one that last worked for this playlist (Xtream only — see live-stream-url.ts).
    setPlaybackUrl(liveStreamUrl(channel, activeSource.id));
  };
  // Recently Watched → a series: play its saved episode with the full episode
  // list (for Next Episode and the Episodes panel). If the episode is gone
  // from the provider, open the series page instead.
  const continueSeries = (entry: WatchHistoryEntry): void => {
    const openSeriesPage = () => {
      setPendingSeriesId(entry.contentId);
      setActiveTab("series");
    };
    loadSeriesDetails(activeSource, entry.contentId)
      .then(({ details, episodes }) => {
        const episode = episodes.find((ep) => ep.id === entry.episodeId);
        if (!episode) return openSeriesPage();
        playEpisode(episode, episodes, { seriesName: entry.title, posterUrl: entry.imageUrl, details, resume: Boolean(entry.positionSeconds) });
      })
      .catch(openSeriesPage);
  };
  const playNextEpisode = (): void => {
    if (nextEpisode) playEpisode(nextEpisode, seriesEpisodes);
  };
  const closePlayback = (): void => {
    setHistoryVersion((v) => v + 1);
    setChannelLineup(null);
    setWatchTarget(undefined);
    setPlaybackChannel(undefined);
    setPlaybackUrl(null);
    setPlaybackIdentity(undefined);
    setPlaybackResume(null);
    setPlaybackAutoResume(false);
    setPlaybackEpisodeId(undefined);
    setPlaybackInfo(undefined);
    setPlaybackTitle(undefined);
    setPlaybackSubtitle(undefined);
    setNextEpisode(null);
    setIsPlaybackLive(false);
    // Only bump when identity was set, i.e. this was resumable VOD/series
    // playback that may have just written a new Continue Watching entry —
    // no need to force a re-read after closing live TV/catch-up.
    if (playbackIdentity) setPlaybackCloseVersion((v) => v + 1);
  };
  closePlaybackRef.current = closePlayback;

  if (activeTab === "home" && !isKids) {
    // Home is a static menu with nothing playable on it, so unlike every
    // other tab below it never hosts a PlayerScreen overlay. (A Kids
    // profile's Home has recommendation rails, so it's rendered below with
    // the other tabs.)
    return (
      <HomeScreen
        source={activeSource}
        sources={sources}
        onSelectSource={handleSetActiveSource}
        platform={platform}
        profile={activeProfile}
        onSelectTile={(tileId) => {
          setPendingSeriesId(null);
          setActiveTab(tileId as TabId);
        }}
        onOpenProfiles={() => {
          setIsLeavingKids(isKids);
          setActiveProfile(null);
        }}
      />
    );
  }

  const goHome = () => {
    setPendingSeriesId(null);
    setActiveTab("home");
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {activeTab === "home" && (
        <KidsHomeScreen
          source={activeSource}
          sources={sources}
          onSelectSource={handleSetActiveSource}
          platform={platform}
          profile={activeProfile}
          policy={policy}
          onSelectTile={(tileId) => {
            setPendingSeriesId(null);
            setActiveTab(tileId as TabId);
          }}
          onOpenProfiles={() => {
            setIsLeavingKids(true);
            setActiveProfile(null);
          }}
          onPlayMovie={playMovie}
          onPlayChannel={playLive}
          onContinueSeries={continueSeries}
          onOpenSeries={(seriesId) => {
            setPendingSeriesId(seriesId);
            setActiveTab("series");
          }}
          refreshKey={historyVersion}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "live" && (
        <LiveTvScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onBack={goHome}
          onPlay={playLive}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "guide" && (
        <GuideScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onPlay={playWithoutIdentity}
          onBack={goHome}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "movies" && (
        <VodScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onPlay={playMovie}
          onBack={goHome}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "series" && (
        <SeriesScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onPlayEpisode={playEpisode}
          onBack={goHome}
          initialSelectedId={pendingSeriesId ?? seriesSelectionId ?? undefined}
          onSelectionChange={setSeriesSelectionId}
          continueWatchingVersion={playbackCloseVersion}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "favourites" && (
        <FavouritesScreen
          source={activeSource}
          profileId={activeProfile.id}
          policy={policy}
          platform={platform}
          onBack={goHome}
          onPlayChannel={playLive}
          onPlayMovie={playMovie}
          onOpenSeries={(seriesId) => {
            setPendingSeriesId(seriesId);
            setActiveTab("series");
          }}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "history" && (
        <HistoryScreen
          source={activeSource}
          profileId={activeProfile.id}
          policy={policy}
          platform={platform}
          onBack={goHome}
          onPlayChannel={playLive}
          onPlayMovie={playMovie}
          onContinueSeries={continueSeries}
          onOpenSeries={(seriesId) => {
            setPendingSeriesId(seriesId);
            setActiveTab("series");
          }}
          refreshKey={historyVersion}
          isPlaybackOpen={Boolean(playbackUrl)}
        />
      )}
      {activeTab === "settings" && !isKids && (
        <SettingsScreen
          platform={platform}
          sources={sources}
          activeSourceId={activeSource?.id}
          onAddSource={handleSourceAdded}
          onRemoveSource={handleRemoveSource}
          onSetActiveSource={handleSetActiveSource}
          onBack={goHome}
          profiles={profiles}
        />
      )}

      {!playbackUrl && activeTab === "home" && syncPillLabel && <SyncPill label={syncPillLabel} />}
      {!playbackUrl && kidsNotice && <Toast message={kidsNotice} tone="error" onDismiss={dismissKidsNotice} />}

      {playbackUrl && (
        <PlayerScreen
            streamUrl={playbackUrl}
            platform={platform}
            identity={playbackIdentity}
            onClose={closePlayback}
            title={playbackTitle}
            subtitle={playbackSubtitle}
            onNextEpisode={nextEpisode ? playNextEpisode : undefined}
            upNextEpisode={nextEpisode}
            isLive={isPlaybackLive}
            liveChannel={playbackChannel}
            guideSource={activeSource}
            channelLineup={playerLineup}
            watchTarget={watchTarget}
            onTuneChannel={(channel) => playLive(channel)}
            liveSourceId={isPlaybackLive ? activeSource.id : undefined}
            resumeFrom={playbackResume}
            autoResume={playbackAutoResume}
            info={playbackInfo}
            episodes={playbackEpisodeId ? seriesEpisodes : undefined}
            currentEpisodeId={playbackEpisodeId}
            onPlayEpisode={(episode) => playEpisode(episode, seriesEpisodes)}
          />
      )}
    </div>
  );
}
