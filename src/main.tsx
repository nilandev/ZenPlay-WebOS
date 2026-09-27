import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShimmerStyles } from "@ui";
import { App } from "./App.js";
import { startBootSplashTimeout } from "./boot-splash.js";
import { purgeLegacyCacheEntries } from "./content-cache.js";

// Background housekeeping only — deletes pre-table cache blobs by key (see
// content-cache.ts). Nothing is preloaded at boot: cached values are read
// from IndexedDB lazily, per key, when a screen first asks for one.
void purgeLegacyCacheEntries();

// The launch splash index.html has shown since the page's first paint stays
// until App has a real screen up (see boot-splash.ts) — or this runs out.
startBootSplashTimeout();

function Root(): JSX.Element {
  return (
    <>
      <ShimmerStyles />
      <App />
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
