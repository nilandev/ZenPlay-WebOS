import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearEpgDbForTests, __resetEpgDbForTests, getChannelProgrammes, getEpgSyncMeta, openEpgDb } from "./core/storage/epg-db.js";
import { EpgEmptyError, runEpgSync } from "./epg-sync-core.js";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

/** XMLTV timestamp for NOW + offsetHours. */
function ts(offsetHours: number): string {
  const d = new Date(NOW + offsetHours * HOUR);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
}
function programme(channel: string, startH: number, stopH: number, title: string): string {
  return `<programme start="${ts(startH)}" stop="${ts(stopH)}" channel="${channel}"><title>${title}</title></programme>`;
}
const xmltv = (...programmes: string[]) => `<?xml version="1.0"?><tv>${programmes.join("")}</tv>`;
const fetchReturning = (body: string, status = 200) => vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => body } as Response);

const request = { sourceId: "src-1", url: "http://tv.example/xmltv.php", windowStartMs: NOW - 2 * HOUR, windowEndMs: NOW + 72 * HOUR };

async function titlesFor(channelId: string): Promise<string[]> {
  return (await getChannelProgrammes(await openEpgDb(), "src-1", channelId)).map((r) => r.title);
}

describe("runEpgSync", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    __resetEpgDbForTests();
    await __clearEpgDbForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("stores the programmes inside the window, in start order, and records what it stored", async () => {
    const body = xmltv(
      programme("bbc", 1, 2, "Later"),
      programme("bbc", -1, 1, "Now"),
      programme("bbc", -10, -5, "Long gone"),
      programme("itv", 100, 101, "Too far ahead"),
      programme("itv", 0, 1, "ITV News"),
    );
    const result = await runEpgSync(request, { fetchImpl: fetchReturning(body) });

    expect(result).toEqual({ programmeCount: 3, channelCount: 2 });
    expect(await titlesFor("bbc")).toEqual(["Now", "Later"]);
    expect(await titlesFor("itv")).toEqual(["ITV News"]);
    expect(await getEpgSyncMeta(await openEpgDb(), "src-1")).toMatchObject({ lastSyncedAt: NOW, programmeCount: 3, channelCount: 2 });
  });

  it("a re-sync replaces the guide: dropped programmes go, repeated ones aren't duplicated", async () => {
    await runEpgSync(request, { fetchImpl: fetchReturning(xmltv(programme("bbc", 0, 1, "Kept"), programme("bbc", 1, 2, "Cancelled"))) });
    vi.setSystemTime(NOW + 1000);
    await runEpgSync(request, { fetchImpl: fetchReturning(xmltv(programme("bbc", 0, 1, "Kept"), programme("bbc", 2, 3, "New show"))) });

    expect(await titlesFor("bbc")).toEqual(["Kept", "New show"]);
  });

  it("keeps the previous guide when a refresh comes back empty or fails", async () => {
    await runEpgSync(request, { fetchImpl: fetchReturning(xmltv(programme("bbc", 0, 1, "Good data"))) });

    await expect(runEpgSync(request, { fetchImpl: fetchReturning(xmltv()) })).rejects.toBeInstanceOf(EpgEmptyError);
    await expect(runEpgSync(request, { fetchImpl: fetchReturning("", 502) })).rejects.toThrow(/HTTP 502/);

    expect(await titlesFor("bbc")).toEqual(["Good data"]);
  });

  it("writes in batches, reports progress, and yields between batches when asked", async () => {
    const body = xmltv(...Array.from({ length: 5 }, (_, i) => programme("bbc", i, i + 1, `Show ${i}`)));
    const onProgress = vi.fn();
    const yieldBetweenBatches = vi.fn().mockResolvedValue(undefined);
    await runEpgSync(request, { fetchImpl: fetchReturning(body), batchSize: 2, onProgress, yieldBetweenBatches });

    expect(onProgress.mock.calls.map(([n]) => n)).toEqual([2, 4, 5]);
    expect(yieldBetweenBatches).toHaveBeenCalled();
    expect(await titlesFor("bbc")).toHaveLength(5);
  });

  it("skips a programme with a malformed timestamp instead of losing the whole guide", async () => {
    const body = xmltv(`<programme start="garbage" stop="${ts(1)}" channel="bbc"><title>Broken</title></programme>`, programme("bbc", 0, 1, "Fine"));
    await runEpgSync(request, { fetchImpl: fetchReturning(body) });
    expect(await titlesFor("bbc")).toEqual(["Fine"]);
  });
});
