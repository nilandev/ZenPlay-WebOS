/** Matches #boot-splash's opacity transition in index.html. */
const FADE_OUT_MS = 400;
/** The longest the splash stays up, whatever happens — it must never become a blocking screen. */
const MAX_SPLASH_MS = 4000;

let dismissed = false;

/**
 * Fades out and removes the launch splash that index.html paints before any
 * script runs (see its #boot-splash comment). App calls this once it's
 * showing a real screen — Home, the profile picker, Add Playlist or the
 * first-download screen — not on its first render, which on a relaunch is
 * a passing state (the saved profile not yet restored, the first-download
 * check not yet answered) that would otherwise flash between the splash and
 * Home. Waits two frames so that screen has painted underneath. Safe to
 * call more than once.
 */
export function dismissBootSplash(): void {
  if (dismissed) return;
  dismissed = true;
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add("is-hidden");
      setTimeout(() => splash.remove(), FADE_OUT_MS);
    }),
  );
}

/** Started at boot: dismisses the splash after MAX_SPLASH_MS if App hasn't by then. Never tied to a data fetch. */
export function startBootSplashTimeout(): void {
  setTimeout(dismissBootSplash, MAX_SPLASH_MS);
}

/** Test-only. */
export function __resetBootSplashForTests(): void {
  dismissed = false;
}
