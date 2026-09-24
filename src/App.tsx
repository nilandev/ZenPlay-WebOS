import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlaylistSource, Profile, SeriesEpisode } from "@core";
import {
  addPlaylistSource,
  getActivePlaylistSourceId,
  loadPlaylistSources,
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
import { buildRevalidationTargets, revalidateStaleTargets } from "./cache-revalidator.js";
import { loadMovieDetails } from "./content-loader.js";
import { AddSourceScreen } from "./screens/AddSourceScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { LiveTvScreen } from "./screens/LiveTvScreen.js";
import { VodScreen } from "./screens/VodScreen.js";
import { SeriesScreen, type EpisodePlayContext } from "./screens/SeriesScreen.js";
import { yearFromDate, type PlaybackInfo } from "./screens/PlayerOverlays.js";
import { GuideScreen } from "./screens/GuideScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { ManagePlaylistsScreen } from "./screens/ManagePlaylistsScreen.js";
import { FavouritesScreen } from "./screens/FavouritesScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { ManageProfilesScreen } from "./screens/ManageProfilesScreen.js";
import { PlaceholderScreen } from "./screens/PlaceholderScreen.js";
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
  { id: "manage-playlists", label: "Manage Playlists" },
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

  useEffect(() => {
    const savedId = getActiveProfileId();
    const saved = savedId ? profiles.find((p) => p.id === savedId) : undefined;
    if (saved) setActiveProfile(saved);
    // Only re-check localStorage-persisted active profile once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kicks off HomeScreen's usual content fetches (live channels, VOD/series
  // categories, EPG, playlist info — see buildRevalidationTargets) as soon
  // as a profile is selected/restored, rather than waiting for HomeScreen to
  // mount and start them itself. This is what actually delivers spec
  // Scenario A's "data ready the millisecond Home renders": previously,
  // Home's own skeletons covered the wait, but the wait only started once
  // Home was already on screen. Firing it here means the fetches are
  // in-flight during the login/profile-select transition instead. This is
  // now the only automatic revalidation: HomeScreen no longer runs its own
  // background revalidator/prefetch/catalog-sync jobs (it's a static menu
  // that does no data work — see its doc comment). A brand-new source's
  // local VOD/series catalog tables aren't included here (see
  // buildRevalidationTargets' doc comment on why they're excluded from this
  // revalidator entirely) — VodScreen/SeriesScreen start their own catalog's
  // sync while open (see catalog-sync.ts's startCatalogBackgroundSync).
  useEffect(() => {
    if (!activeSource || !activeProfile) return;
    void revalidateStaleTargets(buildRevalidationTargets(activeSource));
  }, [activeSource, activeProfile]);

  function handleSourceAdded(source: PlaylistSource): void {
    const updated = addPlaylistSource(source);
    setSources(updated);
    setActivePlaylistSourceId(source.id);
    setActiveSourceIdState(source.id);
  }

  function handleRemoveSource(sourceId: string): void {
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
    const updated = addProfile(profile);
    setProfiles(updated);
    setActiveProfile(profile);
    setActiveProfileId(profile.id);
  }

  function handleSelectProfile(profile: Profile): void {
    setActiveProfile(profile);
    setActiveProfileId(profile.id);
  }

  function handleUpdateAnyProfile(profileId: string, patch: Partial<Profile>): void {
    setProfiles(updateProfile(profileId, patch));
  }

  function handleDeleteProfile(profileId: string): void {
    setProfiles(deleteProfile(profileId));
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
      />
    );
  }

  // Continue Watching identity helpers — defined here (rather than above)
  // so they can close over activeProfile once it's narrowed non-null by the
  // guard above; live TV/catch-up playback skips identity entirely since
  // Continue Watching doesn't apply to it.
  const playMovie = (movie: Channel): void => {
    setPlaybackIdentity({ profileId: activeProfile.id, contentId: movie.id, contentKind: "movie" });
    setPlaybackResume(getResumePoint(activeProfile.id, movie.id));
    setPlaybackAutoResume(false);
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
    setNextEpisode(findNextEpisode(episode, allEpisodes));
    setSeriesEpisodes(allEpisodes);
    setIsPlaybackLive(false);
    setPlaybackUrl(episode.streamUrl);
  };
  const playWithoutIdentity = (streamUrl: string): void => {
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
  const playLive = (channel: Channel): void => {
    setPlaybackIdentity(undefined);
    setPlaybackResume(null);
    setPlaybackAutoResume(false);
    setPlaybackEpisodeId(undefined);
    setPlaybackInfo({ logoUrl: channel.logoUrl });
    setPlaybackTitle(channel.name);
    setPlaybackSubtitle(undefined);
    setNextEpisode(null);
    setIsPlaybackLive(true);
    setPlaybackUrl(channel.streamUrl);
  };
  const playNextEpisode = (): void => {
    if (nextEpisode) playEpisode(nextEpisode, seriesEpisodes);
  };
  const closePlayback = (): void => {
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

  if (activeTab === "home") {
    // Home is a static menu with nothing playable on it, so unlike every
    // other tab below it never hosts a PlayerScreen overlay.
    return (
      <HomeScreen
        source={activeSource}
        platform={platform}
        profile={activeProfile}
        onSelectTile={(tileId) => {
          setPendingSeriesId(null);
          setActiveTab(tileId as TabId);
        }}
        onOpenProfiles={() => setActiveProfile(null)}
      />
    );
  }

  const goHome = () => {
    setPendingSeriesId(null);
    setActiveTab("home");
  };

  return (
    <div style={{ minHeight: "100vh" }}>
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
      {activeTab === "history" && <PlaceholderScreen title="History" icon="🕘" platform={platform} onBack={goHome} />}
      {activeTab === "settings" && (
        <SettingsScreen platform={platform} onManagePlaylists={() => setActiveTab("manage-playlists")} onBack={goHome} />
      )}
      {activeTab === "manage-playlists" && (
        <ManagePlaylistsScreen
          sources={sources}
          activeSourceId={activeSource?.id}
          platform={platform}
          onBack={() => setActiveTab("settings")}
          onAddSource={handleSourceAdded}
          onRemoveSource={handleRemoveSource}
          onSetActiveSource={handleSetActiveSource}
        />
      )}

      {playbackUrl && (
        <PlayerScreen
            streamUrl={playbackUrl}
            platform={platform}
            identity={playbackIdentity}
            onClose={closePlayback}
            title={playbackTitle}
            subtitle={playbackSubtitle}
            onNextEpisode={nextEpisode ? playNextEpisode : undefined}
            isLive={isPlaybackLive}
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
