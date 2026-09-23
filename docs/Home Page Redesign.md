Here is a comprehensive product specification and feature requirement for transforming the current home page into the new **Left Vertical Navigation & Cinematic Hero** layout (as visualized in the updated design), with robust handling for first-time loads and cold starts.

---

### **Epic: Home Page Redesign (Left-Nav & Cinematic Hero Layout)**

#### **1. Overview & Objective**

Migrate the current centered-card dashboard layout to a modern, media-forward interface featuring a **Left Vertical Sidebar** and a **Cinematic Hero Content Area** accompanied by horizontal dynamic shelves. The sidebar is scoped to the Home screen (rendered per-screen, matching the app's existing tab-swap navigation model) rather than persistent app-level chrome shared across all screens. The architecture must gracefully manage data states ranging from an empty cold-start (first-time install) to fast-loading cached sessions.

---

#### **2. UX & State Scenarios Specification**

##### **Scenario A: First-Time Load / Cold Start (No Local Cache)**

* **The Challenge:** When a user logs in for the very first time, local storage is empty. Fetching categories, VOD streams, and live channels from the Xtream API introduces network latency. Showing a blank screen or a broken layout causes user drop-off.
* **UX Solution:**
* **Skeleton Placeholders:** Render a high-fidelity skeleton loading state immediately upon successful authentication. The left sidebar outline, a large pulsing hero banner placeholder, and shimmering row blocks for content shelves must display instantly.
* **Pre-Caching on Auth:** Trigger background API requests (`get_live_categories`, `get_vod_streams`, `get_series`) during the login/splash screen phase so data is ready the millisecond the home page renders.
* **Fallback Hero Data:** If API response is delayed, display a default branded welcome banner or the provider's top available featured stream to prevent empty voids.



##### **Scenario B: Subsequent Loads (With Local Cache)**

* **The Challenge:** Returning users expect instant rendering.
* **UX Solution:**
* Read from the local database/cache instantly to render the UI shell, last-known hero item, and cached shelves (Favorites, History, Categories) with zero perceived latency.
* Execute a non-blocking background sync to fetch updated EPG or new VOD additions silently.



##### **Scenario C: Dynamic Row Handling (Day 1 / Empty Watch History)**

* **The Challenge:** Rows like **"Continue Watching"** or **"Favorites"** will be completely empty for a brand-new user. Empty rows with "No items found" look broken on a TV interface.


* **UX Solution:**
* **Conditional Rendering:** If `ContinueWatching.length === 0`, completely **collapse and omit** that row from the DOM on first launch. Do not render empty containers.
* **Smart Promotion:** Replace empty dynamic rows with curated fallback shelves on Day 1, such as "Trending Movies", "Popular Live Channels", or "Featured Series" fetched from the Xtream API. As the user interacts with the app, dynamically inject "Continue Watching" right below the Hero area.



---

#### **3. Functional Layout Requirements**

* Left Vertical Sidebar Navigation:


* Fixed-width navigation bar on the left edge of the Home screen (rendered as part of HomeScreen, not shared persistent chrome across other screens).
* Houses primary app destinations: **Home**, **Live TV**, **Movies**, **Series**, **Favorites**, and **Settings**. Selecting a destination other than Home navigates away using the existing tab-swap mechanism.


* Optimized for D-pad navigation: Pressing `Left` from any main content card focuses the sidebar; pressing `Right` returns focus to the active content area.


* Cinematic Hero Area:


* Occupies the primary upper-right focal zone.
* Features a high-resolution backdrop image, title metadata (genre/tags), and a prominent **Play / Details** button.


* Automatically cycles through or highlights featured VOD or live sporting events based on local cache or API curation.


* Horizontal Content Shelves:


* Scrollable rows underneath the hero (e.g., *Continue Watching*, *Trending Now*).


* Smooth horizontal focus-snapping behavior tailored for TV remote controls.



---

#### **4. Acceptance Criteria**

1. **AC1:** The Home screen successfully renders the new Left Vertical Sidebar and Hero layout structure on launch.


2. **AC2:** On first-time installation (cold start), skeleton loaders appear immediately, avoiding any static blank screen while local cache initializes.
3. **AC3:** If "Continue Watching" or "Favorites" data arrays are empty, the corresponding rows automatically hide themselves without leaving dead space or error messages.
4. **AC4:** D-pad navigation allows seamless transition between the Left Sidebar and the Hero/Shelves area without focus traps or unresponsive states.
5. **AC5:** Subsequent app launches load instantly by reading cached metadata from local storage while performing background silent updates.


# Acceptance Criteria for Multi-Size TV Compatibility

- AC1 (Safe Area): All core UI elements (Home screen's sidebar navigation, top status bar, and bottom info text) remain fully visible and unobstructed within standard hardware overscan boundaries across all supported display sizes.

- AC2 (Dynamic Scaling): The application layout scales proportionally using density-independent measurements without breaking alignment or causing text overlapping when switching between 720p, 1080p, and 4K display outputs.

- AC3 (Legibility): All typography maintains minimum readable font thresholds, ensuring clear readability from a 10-foot viewing distance.

- AC4 (Content Reflow): Horizontal content shelves adjust card spacing and count dynamically to fill variable screen widths smoothly without clipping partial cards awkwardly at the edge.