import { useEffect, useRef, useState } from "react";
import type { PlatformId } from "@core";
import { ChevronRight, Check } from "lucide-react";
import { BROWSE_SIDE_PADDING, Focusable, MeshBackground, TV_TEXT, useFocusStore, useIsFocused, useRemoteInput, type FocusNode } from "@ui";
import { loadSettings, updateSettings, type AppSettings, type PlaybackSpeed, type VideoQuality } from "../settings-store.js";

const MANAGE_PLAYLISTS_ID = "settings-manage-playlists";
const AUTO_REFRESH_ID = "settings-auto-refresh";
const SCOPE = "settings";
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

/** Settings list width — a comfortable reading measure on a 16:9 TV, left-aligned like tvOS Settings. */
const LIST_MAX_WIDTH = "76rem";

export interface SettingsScreenProps {
  platform: PlatformId;
  onManagePlaylists: () => void;
  onBack: () => void;
}

/**
 * App Settings, sized for TV: a wide, left-aligned list of large rows
 * grouped into sections (Playlists, Playback, About). The focused row or
 * option is solid white — the app-wide focus style — and the chosen option
 * in a picker carries a ✓.
 *
 * Values in the first two sections are persisted via settings-store.ts but
 * not yet read by the player/refresh scheduler.
 */
export function SettingsScreen({ platform, onManagePlaylists, onBack }: SettingsScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Read through a ref inside the focus-graph onSelect closures below so the
  // graph-building effect doesn't need `settings` in its dependencies —
  // rebuilding (and re-focusing) on every toggle would undo navigation.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onManagePlaylistsRef = useRef(onManagePlaylists);
  onManagePlaylistsRef.current = onManagePlaylists;

  function patch(update: Partial<AppSettings>): void {
    setSettings(updateSettings(update));
  }

  useEffect(() => {
    const qualityIds = VIDEO_QUALITY_OPTIONS.map((o) => videoQualityId(o.value));
    const speedIds = PLAYBACK_SPEED_OPTIONS.map((o) => playbackSpeedId(o.value));
    // Up/Down between the two picker rows keep the column position (clamped).
    const at = (ids: string[], index: number) => ids[Math.min(index, ids.length - 1)];

    const nodes: FocusNode[] = [
      { id: MANAGE_PLAYLISTS_ID, neighbors: { down: AUTO_REFRESH_ID }, onSelect: () => onManagePlaylistsRef.current() },
      {
        id: AUTO_REFRESH_ID,
        neighbors: { up: MANAGE_PLAYLISTS_ID, down: qualityIds[0] },
        onSelect: () => patch({ automaticRefresh: !settingsRef.current.automaticRefresh }),
      },
      ...qualityIds.map((id, index) => ({
        id,
        neighbors: {
          up: AUTO_REFRESH_ID,
          down: at(speedIds, index),
          left: qualityIds[index - 1],
          right: qualityIds[index + 1],
        },
        onSelect: () => patch({ videoQuality: VIDEO_QUALITY_OPTIONS[index].value }),
      })),
      ...speedIds.map((id, index) => ({
        id,
        neighbors: {
          up: at(qualityIds, index),
          left: speedIds[index - 1],
          right: speedIds[index + 1],
        },
        onSelect: () => patch({ playbackSpeed: PLAYBACK_SPEED_OPTIONS[index].value }),
      })),
    ];

    setGraph(SCOPE, nodes, MANAGE_PLAYLISTS_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGraph]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useEffect(() => {
    focus(MANAGE_PLAYLISTS_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRemoteInput(platform, { onBack });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", padding: `3rem ${BROWSE_SIDE_PADDING} 4rem`, boxSizing: "border-box" }}>
        <div style={{ maxWidth: LIST_MAX_WIDTH }}>
          <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>App Settings</h1>
          <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.5rem 0 2.5rem" }}>Playlists, playback preferences and app information.</p>

          <SettingsSection title="Playlists">
            <NavRow id={MANAGE_PLAYLISTS_ID} label="Manage Playlists" description="Add, remove, refresh or switch your playlists" onSelect={onManagePlaylists} />
            <ToggleRow
              id={AUTO_REFRESH_ID}
              label="Automatic Refresh"
              description="Periodically refresh channel and programme data"
              value={settings.automaticRefresh}
              onToggle={() => patch({ automaticRefresh: !settings.automaticRefresh })}
            />
          </SettingsSection>

          <SettingsSection title="Playback">
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
            <InfoRow label="Build" value={__BUILD_ID__} />
            <InfoRow label="Developer" value="Nilanchal Panigrahy" />
          </SettingsSection>
        </div>
      </div>
    </MeshBackground>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 800, color: "rgba(235,236,242,0.55)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 1rem" }}>
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>{children}</div>
    </section>
  );
}

/** Row surface: glass when idle, solid white (dark text) when focused. */
function rowStyle(isFocused: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "2rem",
    width: "100%",
    minHeight: "5.5rem",
    padding: "1.125rem 1.75rem",
    boxSizing: "border-box",
    border: "none",
    borderRadius: "1.125rem",
    background: isFocused ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.07)",
    boxShadow: isFocused ? "0 1rem 2rem -0.75rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.06)",
    color: isFocused ? "#0b0c10" : "#ffffff",
    textAlign: "left",
    cursor: "pointer",
  };
}

function RowText({ label, description, isFocused }: { label: string; description?: string; isFocused: boolean }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: 0 }}>
      <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>{label}</span>
      {description && <span style={{ fontSize: "1.125rem", color: isFocused ? "rgba(11,12,16,0.65)" : "rgba(235,236,242,0.6)" }}>{description}</span>}
    </div>
  );
}

function NavRow({ id, label, description, onSelect }: { id: string; label: string; description: string; onSelect: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button type="button" onClick={onSelect} style={rowStyle(isFocused)}>
        <RowText label={label} description={description} isFocused={isFocused} />
        <ChevronRight size="2rem" strokeWidth={2} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
    </Focusable>
  );
}

function ToggleRow({ id, label, description, value, onToggle }: { id: string; label: string; description: string; value: boolean; onToggle: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button type="button" onClick={onToggle} role="switch" aria-checked={value} style={rowStyle(isFocused)}>
        <RowText label={label} description={description} isFocused={isFocused} />
        <span style={{ display: "flex", alignItems: "center", gap: "1rem", flexShrink: 0 }}>
          <span style={{ fontSize: TV_TEXT, fontWeight: 700, opacity: 0.75 }}>{value ? "On" : "Off"}</span>
          <span
            aria-hidden
            style={{
              position: "relative",
              width: "4.25rem",
              height: "2.375rem",
              borderRadius: 999,
              background: value ? "var(--accent, #38bdf8)" : isFocused ? "rgba(11,12,16,0.2)" : "rgba(255,255,255,0.18)",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "0.25rem",
                left: value ? "2.125rem" : "0.25rem",
                width: "1.875rem",
                height: "1.875rem",
                borderRadius: "50%",
                background: "#ffffff",
                boxShadow: "0 0.125rem 0.375rem rgba(0,0,0,0.35)",
                transition: "left 160ms ease-out",
              }}
            />
          </span>
        </span>
      </button>
    </Focusable>
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
    <div style={{ ...rowStyle(false), cursor: "default", flexWrap: "wrap" }}>
      <RowText label={label} isFocused={false} />
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {options.map((option) => (
          <PickerOption key={String(option.value)} id={getId(option.value)} label={option.label} isSelected={option.value === value} onClick={() => onSelect(option.value)} />
        ))}
      </div>
    </div>
  );
}

function PickerOption({ id, label, isSelected, onClick }: { id: string; label: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ width: "auto", height: "auto" }}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.625rem 1.375rem",
          border: "none",
          borderRadius: 999,
          fontSize: TV_TEXT,
          fontWeight: isSelected || isFocused ? 700 : 500,
          background: isFocused ? "#ffffff" : isSelected ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
          color: isFocused ? "#0b0c10" : isSelected ? "#ffffff" : "rgba(235,236,242,0.75)",
          boxShadow: isFocused ? "0 0.75rem 1.5rem -0.5rem rgba(0,0,0,0.6)" : undefined,
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        {isSelected && <Check size="1.25rem" strokeWidth={3} />}
        {label}
      </button>
    </Focusable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1.125rem 1.75rem",
        borderRadius: "1.125rem",
        background: "rgba(255,255,255,0.03)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
      }}
    >
      <span style={{ fontSize: TV_TEXT, color: "rgba(235,236,242,0.6)" }}>{label}</span>
      <span style={{ fontSize: TV_TEXT, fontWeight: 700, color: "#fff" }}>{value}</span>
    </div>
  );
}
