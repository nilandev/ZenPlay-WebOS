import { useState } from "react";
import type { PlaylistSource } from "@iptv/core";

export interface AddSourceScreenProps {
  onSourceAdded: (source: PlaylistSource) => void;
}

/**
 * First-run setup: add an Xtream Codes provider or an M3U playlist URL.
 * Kept as plain form inputs (not spatial-nav Focusable tiles) since text
 * entry on TV remotes goes through an on-screen keyboard the webOS
 * runtime provides natively — this screen just needs standard focusable
 * form controls, which webOS's browser already supports.
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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: "radial-gradient(circle at 50% 0%, rgba(110,231,255,0.08), transparent 60%)",
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: "92vw",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 40,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📡</div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Add your playlist</h1>
          <p style={{ marginTop: 6, fontSize: 14 }}>Connect an Xtream Codes provider or an M3U playlist URL.</p>
        </div>

        <div style={{ display: "flex", background: "var(--bg)", borderRadius: 10, padding: 4, marginBottom: 24 }}>
          <ModeTab label="Xtream Codes" active={mode === "xtream"} onClick={() => setMode("xtream")} />
          <ModeTab label="M3U Playlist" active={mode === "m3u-url"} onClick={() => setMode("m3u-url")} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Playlist name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </Field>

          {mode === "xtream" ? (
            <>
              <Field label="Server URL">
                <input
                  placeholder="http://host:port"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Username">
                <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%" }} />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: "100%" }}
                />
              </Field>
            </>
          ) : (
            <Field label="Playlist URL">
              <input
                placeholder="https://example.com/playlist.m3u8"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                style={{ width: "100%" }}
              />
            </Field>
          )}

          <button
            type="submit"
            style={{
              marginTop: 10,
              padding: "14px 0",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "#062028",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            Save & Continue
          </button>
        </form>
      </div>
    </div>
  );
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0",
        borderRadius: 8,
        border: "none",
        background: active ? "var(--surface-raised)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        fontWeight: active ? 700 : 500,
        fontSize: 14,
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-dim)" }}>
      {label}
      {children}
    </label>
  );
}
