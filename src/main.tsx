import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ShimmerStyles, SplashScreen } from "@ui";
import { App } from "./App.js";
import { initContentCacheFromIdb } from "./content-cache.js";

// Warms the in-memory cache from IndexedDB in the background (see
// content-cache.ts) — fired here rather than awaited before the first
// render, so a cold start after webOS suspended/killed the app never delays
// first paint on a storage round-trip. Screens that mount before this
// resolves still render from sessionStorage/empty state as before, then
// pick up any restored data via cache-invalidation-store's version bump
// once this finishes.
void initContentCacheFromIdb();

/**
 * Root component: renders the real App immediately (never blocked on the
 * splash — see SplashScreen's doc comment for why it's not tied to any
 * data fetch) with the animated splash drawn on top as a plain overlay,
 * unmounting itself once its hold+fade finishes. webOS's own static
 * splashBackground (see webos-meta/appinfo.json) covers the OS-level gap
 * before this script even runs; this bridges the moment after that, once
 * React has taken over.
 */
function Root(): JSX.Element {
  const [isSplashing, setIsSplashing] = useState(true);

  return (
    <>
      <ShimmerStyles />
      <App />
      {isSplashing && <SplashScreen onExited={() => setIsSplashing(false)} />}
    </>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
