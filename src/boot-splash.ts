/** Matches #boot-splash's opacity transition in index.html. */
const FADE_OUT_MS = 400;

/**
 * Fades out and removes the launch splash that index.html paints before any
 * script runs (see its #boot-splash comment). Waits two frames first — the
 * first lets the App underneath commit, the second runs once it has
 * painted — so the splash always gives way to a drawn screen, never to an
 * empty page. Never tied to a data fetch: a slow provider must not turn the
 * splash into a blocking screen.
 */
export function dismissBootSplash(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add("is-hidden");
      setTimeout(() => splash.remove(), FADE_OUT_MS);
    }),
  );
}
