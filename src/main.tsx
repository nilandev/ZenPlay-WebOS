import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ShimmerStyles } from "@ui";
import { App } from "./App.js";
import { dismissBootSplash } from "./boot-splash.js";
import { purgeLegacyCacheEntries } from "./content-cache.js";

// Background housekeeping only — deletes pre-table cache blobs by key (see
// content-cache.ts). Nothing is preloaded at boot: cached values are read
// from IndexedDB lazily, per key, when a screen first asks for one.
void purgeLegacyCacheEntries();

/**
 * Root component: renders the real App straight away, then fades out the
 * launch splash index.html has been showing since the page's first paint
 * (see boot-splash.ts).
 */
function Root(): JSX.Element {
  useEffect(dismissBootSplash, []);

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
