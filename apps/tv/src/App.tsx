import { useMemo, useState } from "react";
import type { PlaylistSource } from "@iptv/core";
import { addPlaylistSource, loadPlaylistSources } from "./playlist-store.js";
import { AddSourceScreen } from "./screens/AddSourceScreen.js";
import { LiveTvScreen } from "./screens/LiveTvScreen.js";
import { detectPlatform } from "./platform.js";

export function App(): JSX.Element {
  const platform = useMemo(() => detectPlatform(), []);
  const [sources, setSources] = useState<PlaylistSource[]>(() => loadPlaylistSources());
  const [activeSource, setActiveSource] = useState<PlaylistSource | null>(sources[0] ?? null);

  function handleSourceAdded(source: PlaylistSource): void {
    const updated = addPlaylistSource(source);
    setSources(updated);
    setActiveSource(source);
  }

  if (!activeSource) {
    return <AddSourceScreen onSourceAdded={handleSourceAdded} />;
  }

  return <LiveTvScreen source={activeSource} platform={platform} />;
}
