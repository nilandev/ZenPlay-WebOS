import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRequestDedupeCacheForTests, type PlaylistSource } from "@core";
import { __clearLiveDbForTests, __resetLiveDbForTests } from "./core/storage/live-db.js";
import { __resetLiveStoreForTests } from "./live-store.js";
import { __resetLiveSyncForTests, clearLiveForSource, LIVE_STALE_AFTER_MS } from "./live-sync.js";
import { useLiveChannels } from "./use-live-channels.js";
import { __resetSyncManagerForTests } from "./sync/sync-manager.js";
import { __resetSyncWorkerClientForTests } from "./workers/sync-worker-client.js";

const source: PlaylistSource = { kind: "xtream", id: "src-live", name: "X", baseUrl: "http://tv.example", username: "me", password: "pw" };

const AUTH_OK = { user_info: { auth: 1, status: "Active", exp_date: null } };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** Routes the fake provider: the login call vs get_live_streams. */
function provider(streams: unknown[], auth: unknown = AUTH_OK) {
  return vi.fn((url: string) => Promise.resolve(json(decodeURIComponent(url).includes("action=get_live_streams") ? streams : auth)));
}
const liveStreamCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => decodeURIComponent(String(url)).includes("get_live_streams")).length;

describe("useLiveChannels (main-thread path — jsdom has no Worker)", () => {
  beforeEach(async () => {
    __resetSyncWorkerClientForTests({ workerAvailable: false });
    __resetLiveSyncForTests();
    __resetSyncManagerForTests({ retries: 0 });
    __resetLiveStoreForTests();
    __resetRequestDedupeCacheForTests();
    __resetLiveDbForTests();
    await __clearLiveDbForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds the list on first use, showing loading until the sync lands", async () => {
    const fetchMock = provider([{ stream_id: 1, name: "BBC One" }, { stream_id: 2, name: "ITV" }]);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useLiveChannels(source));
    expect(result.current.isInitialLoading).toBe(true);

    await waitFor(() => expect(result.current.channels.map((c) => c.name)).toEqual(["BBC One", "ITV"]));
    expect(result.current.isInitialLoading).toBe(false);
    expect(liveStreamCalls(fetchMock)).toBe(1);
  });

  it("serves a known list instantly on the next mount, without refetching while fresh", async () => {
    const fetchMock = provider([{ stream_id: 1, name: "BBC One" }]);
    vi.stubGlobal("fetch", fetchMock);
    const first = renderHook(() => useLiveChannels(source));
    await waitFor(() => expect(first.result.current.channels).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => useLiveChannels(source));
    expect(second.result.current).toMatchObject({ isInitialLoading: false, channels: [expect.objectContaining({ name: "BBC One" })] });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(liveStreamCalls(fetchMock)).toBe(1);
  });

  it("shows a stale stored list without refetching it — refreshing is the scheduler's job", async () => {
    const fetchMock = provider([{ stream_id: 1, name: "Old" }]);
    vi.stubGlobal("fetch", fetchMock);
    const first = renderHook(() => useLiveChannels(source));
    await waitFor(() => expect(first.result.current.channels).toHaveLength(1));
    first.unmount();

    __resetLiveStoreForTests(); // fresh session: nothing in memory, list only in the table
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + LIVE_STALE_AFTER_MS + 1);

    const { result } = renderHook(() => useLiveChannels(source));
    await waitFor(() => expect(result.current.channels.map((c) => c.name)).toEqual(["Old"]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(liveStreamCalls(fetchMock)).toBe(1);
  });

  it("reports a failed first sync (bad login) as an error while still loading", async () => {
    vi.stubGlobal("fetch", provider([], { user_info: { auth: 0 } }));
    const { result } = renderHook(() => useLiveChannels(source));
    await waitFor(() => expect(result.current.error).toMatch(/authentication failed/i));
    expect(result.current.isInitialLoading).toBe(true);
  });

  it("does nothing while disabled", async () => {
    const fetchMock = provider([]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLiveChannels(source, { enabled: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(result.current).toEqual({ channels: [], isInitialLoading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clearLiveForSource empties the list and a mounted screen rebuilds it", async () => {
    const fetchMock = provider([{ stream_id: 1, name: "BBC One" }]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLiveChannels(source));
    await waitFor(() => expect(result.current.channels).toHaveLength(1));

    await act(async () => {
      await clearLiveForSource(source.id);
    });
    await waitFor(() => expect(liveStreamCalls(fetchMock)).toBe(2));
    await waitFor(() => expect(result.current.channels).toHaveLength(1));
  });
});
