import { useEffect, useMemo, useState } from "react";
import type { PlaylistSource, Profile } from "@core";
import { addPlaylistSource, loadPlaylistSources } from "./playlist-store.js";
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
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(), []);
  const [sources, setSources] = useState<PlaylistSource[]>(() => loadPlaylistSources());
  const [activeSource, setActiveSource] = useState<PlaylistSource | null>(sources[0] ?? null);

  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [isManagingProfiles, setIsManagingProfiles] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

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
    setActiveSource(source);
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
          onSelectTile={(tileId) => setActiveTab(tileId as TabId)}
          onOpenProfiles={() => setActiveProfile(null)}
        />
        {playbackUrl && <PlayerScreen streamUrl={playbackUrl} platform={platform} onClose={() => setPlaybackUrl(null)} />}
      </div>
    );
  }

  const goHome = () => setActiveTab("home");

  return (
    <div style={{ minHeight: "100vh" }}>
      {activeTab === "live" && <LiveTvScreen source={activeSource} platform={platform} onBack={goHome} />}
      {activeTab === "guide" && <GuideScreen source={activeSource} platform={platform} onPlay={setPlaybackUrl} onBack={goHome} />}
      {activeTab === "movies" && (
        <VodScreen source={activeSource} platform={platform} onPlay={(movie) => setPlaybackUrl(movie.streamUrl)} onBack={goHome} />
      )}
      {activeTab === "series" && (
        <SeriesScreen
          source={activeSource}
          platform={platform}
          onPlayEpisode={(episode) => setPlaybackUrl(episode.streamUrl)}
          onBack={goHome}
        />
      )}
      {activeTab === "favourites" && <PlaceholderScreen title="My Favourite" icon="❤" platform={platform} onBack={goHome} />}
      {activeTab === "history" && <PlaceholderScreen title="History" icon="🕘" platform={platform} onBack={goHome} />}
      {activeTab === "settings" && (
        <SettingsScreen platform={platform} profile={activeProfile} onSwitchProfile={() => setActiveProfile(null)} onBack={goHome} />
      )}

      {playbackUrl && <PlayerScreen streamUrl={playbackUrl} platform={platform} onClose={() => setPlaybackUrl(null)} />}
    </div>
  );
}
