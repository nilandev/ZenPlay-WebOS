import { useEffect, useRef, useState } from "react";
import type { PlatformId } from "@core";
import { Focusable, MeshBackground, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { loadSettings, updateSettings, type AppSettings, type PlaybackSpeed, type VideoQuality } from "../settings-store.js";

const MANAGE_PLAYLISTS_ID = "settings-manage-playlists";
const AUTO_REFRESH_ID = "settings-auto-refresh";
const videoQualityId = (value: VideoQuality) => `settings-video-quality:${value}`;
const playbackSpeedId = (value: PlaybackSpeed) => `settings-playback-speed:${value}`;

const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const PLAYBACK_SPEED_OPTIONS: { value: PlaybackSpeed; label: string }[] = [
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

export interface SettingsScreenProps {
  platform: PlatformId;
  onManagePlaylists: () => void;
  onBack: () => void;
}

/**
 * Settings — three sections (Playlists, Playback Settings, About), a
 * vertical D-pad-navigable list rather than the previous single
 * Switch-Profile row. Every value in the first two sections is UI-only for
 * now: persisted via settings-store.ts so the screen reflects the same
 * choice across sessions, but nothing downstream (player, refresh
 * scheduler) reads it yet — see conversation history. Profile switching
 * moved to the profile chip on Home; this screen previously duplicated it
 * as "Switch profile" but that's no longer where profile-level actions
 * live.
 */
export function SettingsScreen({ platform, onManagePlaylists, onBack }: SettingsScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Read through a ref inside the focus-graph onSelect closures below so the
  // graph-building effect doesn't need `settings` in its dependency array —
  // it previously did, which rebuilt the graph (and re-forced focus back to
  // the top via focus()) on every single toggle/pick, silently undoing
  // ArrowDown/ArrowRight navigation after any interaction (see conversation
  // history for the full trace of that bug).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  function patch(update: Partial<AppSettings>): void {
    setSettings(updateSettings(update));
  }

  useEffect(() => {
    const qualityIds = VIDEO_QUALITY_OPTIONS.map((o) => videoQualityId(o.value));
    const speedIds = PLAYBACK_SPEED_OPTIONS.map((o) => playbackSpeedId(o.value));

    const nodes: FocusNode[] = [
      {
        id: MANAGE_PLAYLISTS_ID,
        neighbors: { down: AUTO_REFRESH_ID },
        onSelect: onManagePlaylists,
      },
      {
        id: AUTO_REFRESH_ID,
        neighbors: { up: MANAGE_PLAYLISTS_ID, down: qualityIds[0] },
        onSelect: () => patch({ automaticRefresh: !settingsRef.current.automaticRefresh }),
      },
      ...qualityIds.map((id, index) => ({
        id,
        neighbors: {
          up: index === 0 ? AUTO_REFRESH_ID : undefined,
          down: speedIds[0],
          left: index > 0 ? qualityIds[index - 1] : undefined,
          right: index < qualityIds.length - 1 ? qualityIds[index + 1] : undefined,
        },
        onSelect: () => patch({ videoQuality: VIDEO_QUALITY_OPTIONS[index].value }),
      })),
      ...speedIds.map((id, index) => ({
        id,
        neighbors: {
          up: qualityIds[0],
          left: index > 0 ? speedIds[index - 1] : undefined,
          right: index < speedIds.length - 1 ? speedIds[index + 1] : undefined,
        },
        onSelect: () => patch({ playbackSpeed: PLAYBACK_SPEED_OPTIONS[index].value }),
      })),
    ];

    setGraph("settings", nodes, MANAGE_PLAYLISTS_ID);
    return () => clearGraph("settings");
  }, [setGraph, clearGraph, onManagePlaylists]);

  useEffect(() => {
    // setGraph only defaults focus to a scope's first node when the
    // currently focused id is no longer valid anywhere — TopNav's own
    // "chrome" scope still has a valid focused tab id at this point, so
    // focus must be forced into the content explicitly, once, on mount
    // (same fix as ProfileForm's confirm dialog — see conversation
    // history). Deliberately not re-run on every graph rebuild, unlike the
    // effect above — see its comment.
    focus(MANAGE_PLAYLISTS_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRemoteInput(platform, { onBack });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 48px 64px", gap: 8 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text)" }}>Settings</h1>
        <p style={{ marginBottom: 40, color: "var(--text-dim)" }}>Manage your playlists, playback preferences, and app info.</p>

        <div style={{ width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", gap: 40 }}>
          <SettingsSection title="Playlists">
            <Focusable id={MANAGE_PLAYLISTS_ID}>
              <NavRow id={MANAGE_PLAYLISTS_ID} label="Manage Playlists" description="Add, remove, or switch your playlist sources" onClick={onManagePlaylists} />
            </Focusable>
            <Focusable id={AUTO_REFRESH_ID}>
              <ToggleRow
                id={AUTO_REFRESH_ID}
                label="Automatic Refresh"
                description="Periodically refresh channel and program data"
                value={settings.automaticRefresh}
                onToggle={() => patch({ automaticRefresh: !settings.automaticRefresh })}
              />
            </Focusable>
          </SettingsSection>

          <SettingsSection title="Playback Settings">
            <PickerRow
              label="Video Quality"
              options={VIDEO_QUALITY_OPTIONS}
              value={settings.videoQuality}
              getId={videoQualityId}
              onSelect={(value) => patch({ videoQuality: value })}
            />
            <PickerRow
              label="Default Speed"
              options={PLAYBACK_SPEED_OPTIONS}
              value={settings.playbackSpeed}
              getId={playbackSpeedId}
              onSelect={(value) => patch({ playbackSpeed: value })}
            />
          </SettingsSection>

          <SettingsSection title="About">
            <InfoRow label="Version" value={__APP_VERSION__} />
            <InfoRow label="Developer" value="Nilanchal Panigrahy" />
            <InfoRow label="Build ID" value={__BUILD_ID__} />
          </SettingsSection>
        </div>
      </div>
    </MeshBackground>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.8 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function rowStyle(isFocused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    width: "100%",
    padding: "18px 22px",
    borderRadius: 16,
    border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.12)",
    background: isFocused
      ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
      : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
    backdropFilter: "blur(16px) saturate(140%)",
    WebkitBackdropFilter: "blur(16px) saturate(140%)",
    boxShadow: isFocused ? "0 0 0 3px var(--accent), 0 12px 28px -8px rgba(0,0,0,0.5)" : "none",
    transform: isFocused ? "scale(1.015)" : "scale(1)",
    transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
    cursor: "pointer",
    textAlign: "left",
  };
}

function NavRow({ id, label, description, onClick }: { id: string; label: string; description: string; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button type="button" onClick={onClick} style={rowStyle(isFocused)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{description}</span>
      </div>
      <span style={{ fontSize: 20, color: "var(--text-dim)" }}>›</span>
    </button>
  );
}

function ToggleRow({
  id,
  label,
  description,
  value,
  onToggle,
}: {
  id: string;
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button type="button" onClick={onToggle} style={rowStyle(isFocused)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{description}</span>
      </div>
      <div
        aria-hidden
        style={{
          position: "relative",
          width: 52,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          background: value ? "var(--accent)" : "rgba(255,255,255,0.14)",
          transition: "background 160ms ease-out",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 3,
            left: value ? 25 : 3,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: value ? "#062028" : "var(--text)",
            transition: "left 160ms ease-out",
          }}
        />
      </div>
    </button>
  );
}

function PickerRow<T extends string | number>({
  label,
  options,
  value,
  getId,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  getId: (value: T) => string;
  onSelect: (value: T) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "18px 22px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{label}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((option) => (
          // Focusable renders width:100% internally (so percentage-height
          // children elsewhere in the app resolve) — inside this flex row
          // that claims the full row width per item, so each option wraps
          // onto its own line instead of sitting side by side. The
          // shrink-to-fit wrapper below contains that 100% to just the
          // button's own size, matching the button's design width instead —
          // see conversation history.
          <div key={String(option.value)} style={{ flex: "0 0 auto" }}>
            <Focusable id={getId(option.value)}>
              <PickerOption id={getId(option.value)} label={option.label} isSelected={option.value === value} onClick={() => onSelect(option.value)} />
            </Focusable>
          </div>
        ))}
      </div>
    </div>
  );
}

function PickerOption({ id, label, isSelected, onClick }: { id: string; label: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        border: isSelected ? "1px solid var(--accent)" : isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.14)",
        background: isSelected ? "rgba(56,189,248,0.18)" : isFocused ? "rgba(255,255,255,0.1)" : "transparent",
        color: isSelected ? "var(--accent)" : isFocused ? "var(--text)" : "var(--text-dim)",
        fontSize: 14,
        fontWeight: 600,
        boxShadow: isFocused ? "0 0 0 3px var(--accent)" : "none",
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 22px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <span style={{ fontSize: 15, color: "var(--text-dim)" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{value}</span>
    </div>
  );
}
