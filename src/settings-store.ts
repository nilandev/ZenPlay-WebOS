export type PlaybackSpeed = 0.5 | 1 | 1.25 | 1.5 | 2;
/** What the launch sync does: nothing, only the parts that are out of date, or everything. */
export type UpdateOnLaunch = "off" | "when-stale" | "always";
export type GuideRefreshHours = 6 | 12 | 24;
export type GuideDaysToKeep = 1 | 3 | 7;
/** Container for Xtream live channels — HLS (.m3u8) or MPEG-TS (.ts). */
export type LiveStreamFormat = "m3u8" | "ts";

export interface AppSettings {
  /** Background checks while the app runs — every 30 min, on return to the foreground, and when the network comes back (see sync-scheduler.ts). */
  automaticRefresh: boolean;
  updateOnLaunch: UpdateOnLaunch;
  /** The programme guide is re-downloaded once it's older than this (see epg-sync.ts). */
  guideRefreshHours: GuideRefreshHours;
  /** How many days ahead of the guide are stored; applies from the next guide update. */
  guideDaysToKeep: GuideDaysToKeep;
  playbackSpeed: PlaybackSpeed;
  /** Xtream live channels only; the player offers the other format if a channel fails (see live-stream-url.ts). */
  liveStreamFormat: LiveStreamFormat;
}

const SETTINGS_KEY = "iptv.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  automaticRefresh: true,
  updateOnLaunch: "when-stale",
  guideRefreshHours: 6,
  guideDaysToKeep: 3,
  playbackSpeed: 1,
  liveStreamFormat: "m3u8",
};

/**
 * App settings, persisted in localStorage. Each is read at the moment it
 * matters, so a change applies without a restart: sync-scheduler.ts on each
 * trigger, epg-sync.ts on each guide check, and PlayerScreen each time a
 * stream starts (speed for films/episodes/catch-up — live is always 1x).
 */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or unavailable — the change still applies for this session via the returned value.
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const settings = { ...loadSettings(), ...patch };
  saveSettings(settings);
  return settings;
}
