/**
 * The root font size in px — what 1rem currently equals. index.html scales
 * it with viewport width (16px at 1920px wide), so components that position
 * things in px (windowed lists, the guide timeline) convert their rem sizes
 * with this rather than assuming 16.
 */
export function readRemPx(): number {
  if (typeof document === "undefined") return 16;
  const value = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(value) && value > 0 ? value : 16;
}
