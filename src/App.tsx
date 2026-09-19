import { useEffect, useMemo, useState } from "react";
import type { PlaylistSource, Profile } from "@core";
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
} from "./profile-store.js";
import { AddSourceScreen } from "./screens/AddSourceScreen.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { LiveTvScreen } from "./screens/LiveTvScreen.js";
import { VodScreen } from "./screens/VodScreen.js";
import { SeriesScreen } from "./screens/SeriesScreen.js";
import { GuideScreen } from "./screens/GuideScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { ManagePlaylistsScreen } from "./screens/ManagePlaylistsScreen.js";
import { FavouritesScreen } from "./screens/FavouritesScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { ManageProfilesScreen } from "./screens/ManageProfilesScreen.js";
import { PlaceholderScreen } from "./screens/PlaceholderScreen.js";
import { PlayerScreen } from "./screens/PlayerScreen.js";
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
  // Set when navigating to Series from a favourited series (My Favourite),
  // so SeriesScreen opens straight into that series' episode list instead
  // of its shelf browser. Cleared once SeriesScreen mounts with it.
  const [pendingSeriesId, setPendingSeriesId] = useState<string | null>(null);

  useEffect(() => {
    const savedId = getActiveProfileId();
    const saved = savedId ? profiles.find((p) => p.id === savedId) : undefined;
    if (saved) setActiveProfile(saved);
    // Only re-check localStorage-persisted active profile once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return <AddSourceScreen onSourceAdded={handleSourceAdded} />;
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

  if (activeTab === "home") {
    return (
      <div style={{ minHeight: "100vh" }}>
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
        {playbackUrl && <PlayerScreen streamUrl={playbackUrl} platform={platform} onClose={() => setPlaybackUrl(null)} />}
      </div>
    );
  }

  const goHome = () => {
    setPendingSeriesId(null);
    setActiveTab("home");
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {activeTab === "live" && <LiveTvScreen source={activeSource} platform={platform} profile={activeProfile} onBack={goHome} />}
      {activeTab === "guide" && <GuideScreen source={activeSource} platform={platform} onPlay={setPlaybackUrl} onBack={goHome} />}
      {activeTab === "movies" && (
        <VodScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onPlay={(movie) => setPlaybackUrl(movie.streamUrl)}
          onBack={goHome}
        />
      )}
      {activeTab === "series" && (
        <SeriesScreen
          source={activeSource}
          platform={platform}
          profile={activeProfile}
          onPlayEpisode={(episode) => setPlaybackUrl(episode.streamUrl)}
          onBack={goHome}
          initialSelectedId={pendingSeriesId ?? undefined}
        />
      )}
      {activeTab === "favourites" && (
        <FavouritesScreen
          source={activeSource}
          profileId={activeProfile.id}
          platform={platform}
          onBack={goHome}
          onPlayChannel={(channel) => setPlaybackUrl(channel.streamUrl)}
          onPlayMovie={(movie) => setPlaybackUrl(movie.streamUrl)}
          onOpenSeries={(seriesId) => {
            setPendingSeriesId(seriesId);
            setActiveTab("series");
          }}
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

      {playbackUrl && <PlayerScreen streamUrl={playbackUrl} platform={platform} onClose={() => setPlaybackUrl(null)} />}
    </div>
  );
}
