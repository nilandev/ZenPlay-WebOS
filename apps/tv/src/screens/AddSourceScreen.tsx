import { useState } from "react";
import type { PlaylistSource } from "@iptv/core";

export interface AddSourceScreenProps {
  onSourceAdded: (source: PlaylistSource) => void;
}

/**
 * First-run setup: add an Xtream Codes provider or an M3U playlist URL.
 * Kept as plain form inputs (not spatial-nav Focusable tiles) since text
 * entry on TV remotes goes through an on-screen keyboard the platform
 * shell provides natively — this screen just needs standard focusable
 * form controls, which webOS/Tizen/Android TV browsers already support.
 */
export function AddSourceScreen({ onSourceAdded }: AddSourceScreenProps): JSX.Element {
  const [mode, setMode] = useState<"xtream" | "m3u-url">("xtream");
  const [name, setName] = useState("My Provider");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const id = crypto.randomUUID();

    if (mode === "xtream") {
      onSourceAdded({ kind: "xtream", id, name, baseUrl, username, password });
    } else {
      onSourceAdded({ kind: "m3u-url", id, name, url: m3uUrl });
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480, padding: 32 }}>
      <h1>Add a playlist</h1>

      <label>
        <input type="radio" checked={mode === "xtream"} onChange={() => setMode("xtream")} /> Xtream Codes
      </label>
      <label>
        <input type="radio" checked={mode === "m3u-url"} onChange={() => setMode("m3u-url")} /> M3U Playlist URL
      </label>

      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

      {mode === "xtream" ? (
        <>
          <input placeholder="Server URL (http://host:port)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </>
      ) : (
        <input placeholder="Playlist URL" value={m3uUrl} onChange={(e) => setM3uUrl(e.target.value)} />
      )}

      <button type="submit">Save & Continue</button>
    </form>
  );
}
