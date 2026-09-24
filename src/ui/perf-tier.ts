import type { CSSProperties } from "react";

/** localStorage override for LITE_EFFECTS: "1" forces lite effects on (e.g. to preview the TV look in a desktop browser), "0" forces them off. */
const LITE_EFFECTS_OVERRIDE_KEY = "zenplay.liteEffects";

function readOverride(): boolean | undefined {
  try {
    const value = localStorage.getItem(LITE_EFFECTS_OVERRIDE_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // localStorage unavailable — fall through to platform detection.
  }
  return undefined;
}

/**
 * True when running inside the webOS runtime (which injects a global
 * `webOS` object — see src/platform.ts's detectPlatform; duplicated here so
 * the ui package doesn't depend on the app shell).
 */
function isWebOsRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { webOS?: unknown }).webOS);
}

/**
 * Rendering tier for GPU/paint-heavy effects. LG TV GPUs can't afford what
 * desktop Chromium does without noticing: every backdrop-filter/filter blur
 * is an extra offscreen render pass per frame (worse over live video), and
 * infinite non-composited animations repaint the screen every frame. When
 * true, components drop those effects for cheap equivalents (solid
 * translucent fills, static backgrounds, overlay dimming) — see
 * docs/defect-lgtv-suggish.md's RCA.
 *
 * Resolved once at module load: the tier is a property of the device, not
 * something that changes mid-session.
 */
export const LITE_EFFECTS: boolean = readOverride() ?? isWebOsRuntime();

/**
 * `backdrop-filter` (plus its -webkit- twin) for a "glass" surface, or
 * nothing at all under LITE_EFFECTS. Spread into a style object:
 * `{ background: ..., ...glassBlur("blur(16px) saturate(140%)") }`.
 * Passing undefined (e.g. a variant that shouldn't be glass) yields nothing.
 */
export function glassBlur(value: string | undefined): CSSProperties {
  if (!value || LITE_EFFECTS) return {};
  return { backdropFilter: value, WebkitBackdropFilter: value };
}
