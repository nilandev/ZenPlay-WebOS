import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ShimmerStyles, SplashScreen } from "@ui";
import { App } from "./App.js";
import { purgeLegacyCacheEntries } from "./content-cache.js";

// Background housekeeping only — deletes pre-table cache blobs by key (see
// content-cache.ts). Nothing is preloaded at boot: cached values are read
// from IndexedDB lazily, per key, when a screen first asks for one.
void purgeLegacyCacheEntries();

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
