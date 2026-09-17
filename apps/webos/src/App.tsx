import { useEffect, useMemo, useState } from "react";
import { XtreamClient, type Category, type PlaylistSource, type Profile } from "@iptv/core";
import { TopNav } from "@iptv/ui";
import { addPlaylistSource, loadPlaylistSources } from "./playlist-store.js";
import { addProfile, getActiveProfileId, loadProfiles, setActiveProfileId, updateProfile } from "./profile-store.js";
import { AddSourceScreen } from "./screens/AddSourceScreen.js";
import { LiveTvScreen } from "./screens/LiveTvScreen.js";
import { VodScreen } from "./screens/VodScreen.js";
import { SeriesScreen } from "./screens/SeriesScreen.js";
import { GuideScreen } from "./screens/GuideScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { PlayerScreen } from "./screens/PlayerScreen.js";
import { detectPlatform } from "./platform.js";
import { proxyFetch } from "./proxy-fetch.js";

const TABS = [
  { id: "live", label: "Live TV" },
  { id: "guide", label: "Guide" },
  { id: "movies", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(), []);
  const [sources, setSources] = useState<PlaylistSource[]>(() => loadPlaylistSources());
  const [activeSource, setActiveSource] = useState<PlaylistSource | null>(sources[0] ?? null);

  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [liveCategories, setLiveCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (activeSource?.kind !== "xtream") return;
    const client = new XtreamClient(activeSource, proxyFetch);
    client
      .authenticate()
      .then(() => client.getLiveCategories())
      .then(setLiveCategories)
      .catch(() => setLiveCategories([]));
  }, [activeSource]);

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

  function handleUpdateProfile(patch: Partial<Profile>): void {
    if (!activeProfile) return;
    const updated = updateProfile(activeProfile.id, patch);
    setProfiles(updated);
    setActiveProfile(updated.find((p) => p.id === activeProfile.id) ?? activeProfile);
  }

  if (!activeSource) {
    return <AddSourceScreen onSourceAdded={handleSourceAdded} />;
  }

  if (!activeProfile) {
    return (
      <ProfilesScreen
        profiles={profiles}
        platform={platform}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <TopNav items={TABS} activeId={activeTab} onSelect={(id) => setActiveTab(id as TabId)} />

      {activeTab === "live" && <LiveTvScreen source={activeSource} platform={platform} profile={activeProfile} />}
      {activeTab === "guide" && <GuideScreen source={activeSource} platform={platform} onPlay={setPlaybackUrl} />}
      {activeTab === "movies" && <VodScreen source={activeSource} platform={platform} onPlay={(movie) => setPlaybackUrl(movie.streamUrl)} />}
      {activeTab === "series" && (
        <SeriesScreen source={activeSource} platform={platform} onPlayEpisode={(episode) => setPlaybackUrl(episode.streamUrl)} />
      )}
      {activeTab === "settings" && (
        <SettingsScreen
          profile={activeProfile}
          categories={liveCategories}
          onUpdateProfile={handleUpdateProfile}
          onSwitchProfile={() => setActiveProfile(null)}
        />
      )}

      {playbackUrl && <PlayerScreen streamUrl={playbackUrl} platform={platform} onClose={() => setPlaybackUrl(null)} />}
    </div>
  );
}
