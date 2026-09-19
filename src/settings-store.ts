export type VideoQuality = "auto" | "low" | "medium" | "high";
export type PlaybackSpeed = 0.5 | 1 | 1.25 | 1.5 | 2;

export interface AppSettings {
  automaticRefresh: boolean;
  videoQuality: VideoQuality;
  playbackSpeed: PlaybackSpeed;
}

const SETTINGS_KEY = "iptv.settings.v1";

const DEFAULT_SETTINGS: AppSettings = {
  automaticRefresh: true,
  videoQuality: "auto",
  playbackSpeed: 1,
};

/**
 * UI-only settings (no playback/refresh wiring yet — see conversation
 * history): persisted so the Settings screen reflects the same values
 * across sessions, but nothing downstream reads these to actually change
 * player quality, playback speed, or schedule a refresh.
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
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const settings = { ...loadSettings(), ...patch };
  saveSettings(settings);
  return settings;
}
