import { useEffect, useRef, useState } from "react";
import type { PlatformId, PlaylistSource } from "@core";
import { Check } from "lucide-react";
import { BROWSE_SIDE_PADDING, Focusable, MeshBackground, TV_TEXT, useFocusStore, useIsFocused, useRemoteInput, type FocusNode } from "@ui";
import {
  loadSettings,
  updateSettings,
  type AppSettings,
  type GuideDaysToKeep,
  type GuideRefreshHours,
  type LiveStreamFormat,
  type PlaybackSpeed,
  type UpdateOnLaunch,
} from "../settings-store.js";
import { AddSourceScreen } from "./AddSourceScreen.js";
import { dismissPlaylistDialog, PlaylistCards, playlistCardId, playlistsEntryFromBelow, ADD_PLAYLIST_ID } from "./PlaylistCards.js";

const AUTO_REFRESH_ID = "settings-auto-refresh";
const SCOPE = "settings";
const updateOnLaunchId = (value: UpdateOnLaunch) => `settings-update-on-launch:${value}`;
const guideRefreshId = (value: GuideRefreshHours) => `settings-guide-refresh:${value}`;
const guideDaysId = (value: GuideDaysToKeep) => `settings-guide-days:${value}`;
const liveFormatId = (value: LiveStreamFormat) => `settings-live-format:${value}`;
const playbackSpeedId = (value: PlaybackSpeed) => `settings-playback-speed:${value}`;

interface Option<T> {
  value: T;
  label: string;
}

const UPDATE_ON_LAUNCH_OPTIONS: Option<UpdateOnLaunch>[] = [
  { value: "off", label: "Off" },
  { value: "when-stale", label: "When out of date" },
  { value: "always", label: "Always" },
];

const GUIDE_REFRESH_OPTIONS: Option<GuideRefreshHours>[] = [
  { value: 6, label: "6 hours" },
  { value: 12, label: "12 hours" },
  { value: 24, label: "24 hours" },
];

const GUIDE_DAYS_OPTIONS: Option<GuideDaysToKeep>[] = [
  { value: 1, label: "1 day" },
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
];

const LIVE_FORMAT_OPTIONS: Option<LiveStreamFormat>[] = [
  { value: "m3u8", label: "HLS (.m3u8)" },
  { value: "ts", label: "MPEG-TS (.ts)" },
];

const PLAYBACK_SPEED_OPTIONS: Option<PlaybackSpeed>[] = [
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
];

/** One row of pickable options: its focus ids, and the settings patch each option applies. */
function pickerRow<T>(options: Option<T>[], getId: (value: T) => string, key: keyof AppSettings): Array<{ id: string; patch: Partial<AppSettings> }> {
  return options.map((option) => ({ id: getId(option.value), patch: { [key]: option.value } as Partial<AppSettings> }));
}

export interface SettingsScreenProps {
  platform: PlatformId;
  sources: PlaylistSource[];
  activeSourceId: string | undefined;
  onAddSource: (source: PlaylistSource) => void;
  onRemoveSource: (sourceId: string) => void;
  onSetActiveSource: (sourceId: string) => void;
  onBack: () => void;
}

/**
 * App Settings. Adding a playlist takes over the whole screen with the Add
 * Playlist form; everything else happens in
 * SettingsView — the same single-input-owner split ManageProfilesScreen
 * uses, since two mounted screens both handling the remote would
 * double-fire every press.
 */
export function SettingsScreen({ onAddSource, platform, ...props }: SettingsScreenProps): JSX.Element {
  const [isAdding, setIsAdding] = useState(false);

  if (isAdding) {
    return (
      <AddSourceScreen
        platform={platform}
        onSourceAdded={(source) => {
          onAddSource(source);
          setIsAdding(false);
        }}
        onCancel={() => setIsAdding(false)}
      />
    );
  }
  return <SettingsView {...props} platform={platform} onAddPlaylist={() => setIsAdding(true)} />;
}

/**
 * The settings page, full screen like the app's other screens, in three
 * sections: Playlists (every playlist as a card, three to a row — see
 * PlaylistCards), Content Settings (keeping playlists and the guide up to
 * date) and Playback, then the app's version and build ID as plain text.
 * The focused card, row or option is solid white — the app-wide focus
 * style — and the chosen option in a picker carries a ✓.
 *
 * Focus starts on the active playlist and moves through the page in
 * order: across and down the cards, then down the settings rows (Left/
 * Right within a row of options, Up/Down keeping the column where the next
 * row has one). One remote handler covers the whole page; Back closes an
 * open Delete/Reset dialog first, then leaves.
 *
 * Every setting is read when it next matters (see settings-store.ts) —
 * the sync scheduler and guide sync on their next check, the player when
 * the next stream starts.
 */
function SettingsView({
  platform,
  sources,
  activeSourceId,
  onRemoveSource,
  onSetActiveSource,
  onBack,
  onAddPlaylist,
}: Omit<SettingsScreenProps, "onAddSource"> & { onAddPlaylist: () => void }): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Read through a ref inside the focus-graph onSelect closures below so the
  // graph-building effect doesn't need `settings` in its dependencies —
  // rebuilding (and re-focusing) on every toggle would undo navigation.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  function patch(update: Partial<AppSettings>): void {
    setSettings(updateSettings(update));
  }

  // Up from the first settings row goes back into the playlist cards.
  const cardsEntryFromBelow = playlistsEntryFromBelow(sources);

  useEffect(() => {
    // Every focusable settings row, top to bottom; each row is one or more items left to right.
    const rows: Array<Array<{ id: string; onSelect: () => void }>> = [
      [{ id: AUTO_REFRESH_ID, onSelect: () => patch({ automaticRefresh: !settingsRef.current.automaticRefresh }) }],
      ...[
        pickerRow(UPDATE_ON_LAUNCH_OPTIONS, updateOnLaunchId, "updateOnLaunch"),
        pickerRow(GUIDE_REFRESH_OPTIONS, guideRefreshId, "guideRefreshHours"),
        pickerRow(GUIDE_DAYS_OPTIONS, guideDaysId, "guideDaysToKeep"),
        pickerRow(LIVE_FORMAT_OPTIONS, liveFormatId, "liveStreamFormat"),
        pickerRow(PLAYBACK_SPEED_OPTIONS, playbackSpeedId, "playbackSpeed"),
      ].map((row) => row.map(({ id, patch: update }) => ({ id, onSelect: () => patch(update) }))),
    ];
    // Up/Down keep the column position, clamped to the neighbouring row's length.
    const at = (row: Array<{ id: string }> | undefined, index: number) => row?.[Math.min(index, row.length - 1)]?.id;

    const nodes: FocusNode[] = rows.flatMap((row, r) =>
      row.map((item, index) => ({
        id: item.id,
        neighbors: {
          up: r === 0 ? cardsEntryFromBelow : at(rows[r - 1], index),
          down: at(rows[r + 1], index),
          left: row[index - 1]?.id,
          right: row[index + 1]?.id,
        },
        onSelect: item.onSelect,
      })),
    );

    setGraph(SCOPE, nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setGraph, cardsEntryFromBelow]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useEffect(() => {
    // Start on the active playlist (the cards register their focus nodes before this parent effect runs).
    const activeCard =
      activeSourceId && sources.some((s) => s.id === activeSourceId) ? playlistCardId(activeSourceId) : sources[0] ? playlistCardId(sources[0].id) : ADD_PLAYLIST_ID;
    focus(activeCard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRemoteInput(platform, {
    onBack: () => {
      if (!dismissPlaylistDialog()) onBack();
    },
  });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", padding: `3rem ${BROWSE_SIDE_PADDING} 4rem`, boxSizing: "border-box" }}>
        <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>App Settings</h1>
        <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.5rem 0 2.5rem" }}>Your playlists, how they stay up to date, and playback.</p>

        <SettingsSection title="Playlist">
          <PlaylistCards
            sources={sources}
            activeSourceId={activeSourceId}
            exitDownId={AUTO_REFRESH_ID}
            onAdd={onAddPlaylist}
            onRemoveSource={onRemoveSource}
            onSetActiveSource={onSetActiveSource}
          />
          <ToggleRow
            id={AUTO_REFRESH_ID}
            label="Automatic Refresh"
            description="Keep channels, movies and the guide up to date in the background"
            value={settings.automaticRefresh}
            onToggle={() => patch({ automaticRefresh: !settings.automaticRefresh })}
          />
          <PickerRow
            label="Update Playlist on Launch"
            description="What to download when the app starts"
            options={UPDATE_ON_LAUNCH_OPTIONS}
            value={settings.updateOnLaunch}
            getId={updateOnLaunchId}
            onSelect={(value) => patch({ updateOnLaunch: value })}
          />
          <PickerRow
            label="Guide Sync Interval"
            options={GUIDE_REFRESH_OPTIONS}
            value={settings.guideRefreshHours}
            getId={guideRefreshId}
            onSelect={(value) => patch({ guideRefreshHours: value })}
          />
          <PickerRow
            label="Days of Guide to Keep"
            description="More days use more storage · applies from the next guide update"
            options={GUIDE_DAYS_OPTIONS}
            value={settings.guideDaysToKeep}
            getId={guideDaysId}
            onSelect={(value) => patch({ guideDaysToKeep: value })}
          />
        </SettingsSection>

        <SettingsSection title="Playback">
          <PickerRow
            label="Live Stream Format"
            description="Xtream live channels · if a channel won't play, the player offers the other format"
            options={LIVE_FORMAT_OPTIONS}
            value={settings.liveStreamFormat}
            getId={liveFormatId}
            onSelect={(value) => patch({ liveStreamFormat: value })}
          />
          <PickerRow
            label="Default Speed"
            description="Films, episodes and catch-up · live TV always plays at normal speed"
            options={PLAYBACK_SPEED_OPTIONS}
            value={settings.playbackSpeed}
            getId={playbackSpeedId}
            onSelect={(value) => patch({ playbackSpeed: value })}
          />
        </SettingsSection>

        <AboutSection />
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
  description,
  options,
  value,
  getId,
  onSelect,
}: {
  label: string;
  description?: string;
  options: Option<T>[];
  value: T;
  getId: (value: T) => string;
  onSelect: (value: T) => void;
}): JSX.Element {
  return (
    <div style={{ ...rowStyle(false), cursor: "default", flexWrap: "wrap" }}>
      <RowText label={label} description={description} isFocused={false} />
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

/**
 * App version and build ID, as plain read-only text at the end of the list
 * — deliberately not a row surface like the settings above (no card, no
 * heading, no focus, nothing to press), so it doesn't read as selectable.
 */
function AboutSection(): JSX.Element {
  const items: Array<[string, string]> = [
    ["Version", __APP_VERSION__],
    ["Build ID", __BUILD_ID__],
  ];
  return (
    <section aria-label="About" style={{ marginTop: "1rem" }}>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "2.5rem", rowGap: "0.625rem", margin: 0, fontSize: "1.25rem" }}>
        {items.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt style={{ color: "rgba(235,236,242,0.55)" }}>{label}</dt>
            <dd style={{ margin: 0, color: "rgba(235,236,242,0.9)", fontVariantNumeric: "tabular-nums", userSelect: "text" }}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
