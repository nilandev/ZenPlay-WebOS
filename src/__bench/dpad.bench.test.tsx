import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { beforeEach, describe, it, vi } from "vitest";
import type { Channel, PlaylistSource, Profile } from "@core";
import { clearAllCachedContent } from "../content-cache.js";
import { useFocusStore } from "../ui/focus/focus-store.js";

const channels: Channel[] = Array.from({ length: 3000 }, (_, i) => ({
  id: `ch-${i}`, name: `Channel number ${i} HD`, groupTitle: `Group ${i % 30}`, streamUrl: `http://x/${i}.m3u8`, kind: "live", logoUrl: `http://x/${i}.png`,
}));
const MOVIE_COUNT = Number(process.env.MOVIES ?? 2000);
const movies: Channel[] = Array.from({ length: MOVIE_COUNT }, (_, i) => ({
  id: `m-${i}`, name: `Movie ${i}`, groupTitle: `cat-${i % 20}`, streamUrl: `http://x/${i}.mp4`, kind: "movie", logoUrl: `http://x/p${i}.jpg`,
}));

vi.mock("../content-loader.js", () => ({
  loadChannelsByKind: vi.fn((_s: unknown, kind: string) => Promise.resolve(kind === "live" ? channels : movies)),
  loadLiveCategories: vi.fn().mockResolvedValue([]),
  loadVodCategories: vi.fn().mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `cat-${i}`, name: `Category ${i}`, kind: "movie" }))),
  loadPlaylistInfo: vi.fn().mockResolvedValue({ name: "P", expiresAt: null }),
}));
vi.mock("@player", () => ({
  HlsPlayerEngine: class {
    attach() {} load() { return Promise.resolve(); } play() { return Promise.resolve(); } pause() {} seekTo() {} unload() {}
    getAudioTracks() { return []; } getSubtitleTracks() { return []; } setAudioTrack() {} setSubtitleTrack() {}
    onTimeUpdate() { return () => {}; } onError() { return () => {}; } destroy() {}
  },
}));

const source: PlaylistSource = { kind: "xtream", id: "s", name: "S", baseUrl: "http://x", username: "u", password: "p" };
const profile: Profile = { id: "p1", name: "A", avatarUrl: "a.png" };

function countListeners(): number {
  // zustand keeps listeners private; count by wrapping a no-op set and observing notifications is overkill —
  // instead count mounted focus subscribers via the DOM: every Focusable renders one data-focus-id element.
  return document.querySelectorAll("[data-focus-id]").length;
}

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

async function bench(name: string, ui: JSX.Element, keys: string[], focusId?: string) {
  let commits = 0; let renderMs = 0;
  const onRender: ProfilerOnRenderCallback = (_id, _phase, actual) => { commits++; renderMs += actual; };
  const { container } = render(<Profiler id={name} onRender={onRender}>{ui}</Profiler>);
  await settle();
  if (focusId) act(() => useFocusStore.getState().focus(focusId));
  const domNodes = container.querySelectorAll("*").length;
  commits = 0; renderMs = 0;
  const t0 = performance.now();
  for (const key of keys) {
    act(() => { fireEvent.keyDown(document, { key }); });
  }
  const total = performance.now() - t0;
  // Store notification alone: set() synchronously runs every subscribed component's selector
  // (useSyncExternalStore checks each one); React's render is scheduled separately.
  let subscribers = 0;
  const unsub = useFocusStore.subscribe(() => {});
  subscribers = (useFocusStore as unknown as { __count?: number }).__count ?? -1;
  unsub();
  const ids = [useFocusStore.getState().focusedId];
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) useFocusStore.setState({ focusedId: i % 2 ? ids[0] : "nonexistent" });
  const notifyMs = (performance.now() - t1) / 20;
  void subscribers;
  // eslint-disable-next-line no-console
  console.log(`${name}: store-notify-only=${notifyMs.toFixed(2)}ms/press, focusables=${document.querySelectorAll("[data-focus-id]").length}`);
  act(() => {});
  // eslint-disable-next-line no-console
  console.log(`${name.padEnd(10)} dom=${String(domNodes).padStart(6)}  per-press: wall=${(total / keys.length).toFixed(2)}ms react=${(renderMs / keys.length).toFixed(2)}ms commits=${(commits / keys.length).toFixed(1)}  focused=${useFocusStore.getState().focusedId}`);
  cleanup();
}

describe("d-pad cost per press", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = () => {}; clearAllCachedContent(); });

  it("home", async () => {
    const { HomeScreen } = await import("../screens/HomeScreen.js");
    await bench("home", <HomeScreen source={source} platform="web" profile={profile} onSelectTile={() => {}} onOpenProfiles={() => {}} />,
      Array.from({ length: 20 }, (_, i) => (i % 2 ? "ArrowLeft" : "ArrowRight")));
  });

  it("live", async () => {
    const { LiveTvScreen } = await import("../screens/LiveTvScreen.js");
    await bench("live", <LiveTvScreen source={source} platform="web" profile={profile} onBack={() => {}} onPlay={() => {}} />,
      Array.from({ length: 40 }, () => "ArrowDown"));
  });

  it("vod", async () => {
    const { VodScreen } = await import("../screens/VodScreen.js");
    await bench("vod", <VodScreen source={source} platform="web" profile={profile} onPlay={() => {}} onBack={() => {}} />,
      Array.from({ length: 40 }, (_, i) => (i < 20 ? "ArrowRight" : "ArrowDown")), "m-0");
  });
});
