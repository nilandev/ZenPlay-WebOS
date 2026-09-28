import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalogWorkerClient } from "./catalog-worker-client.js";
import type { CatalogWorkerRequest, CatalogWorkerResponse } from "./catalog-fetch-worker.js";

/**
 * jsdom has no Worker implementation, and spinning up a real one under
 * Vitest would just be testing jsdom's fidelity rather than this module's
 * own logic — mock the Worker global instead, mirroring xtream-client.test.ts's
 * pattern of stubbing `fetch` rather than hitting a real network. Real
 * webOS Worker behavior is verified via a device/simulator smoke test, not
 * this suite (see the architecture plan this implements).
 */
class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<CatalogWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: CatalogWorkerRequest[] = [];
  terminated = false;

  constructor(public url: URL, public options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  postMessage(message: CatalogWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Test helper: simulates the worker replying to a specific request. */
  respond(response: CatalogWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<CatalogWorkerResponse>);
  }

  /** Test helper: simulates a worker-level error (not tied to one request). */
  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe("createCatalogWorkerClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a message with a generated id and the given request fields", () => {
    const client = createCatalogWorkerClient();
    void client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });

    const worker = MockWorker.instances[0];
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ action: "get_vod_streams", credentials: { baseUrl: "http://x" } });
    expect(worker.posted[0].id).toBeTruthy();
  });

  it("resolves fetchCatalog when the worker responds with ok:true for that request id", async () => {
    const client = createCatalogWorkerClient();
    const promise = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });

    const worker = MockWorker.instances[0];
    const requestId = worker.posted[0].id;
    worker.respond({ id: requestId, ok: true, data: ["item1", "item2"] });

    await expect(promise).resolves.toEqual(["item1", "item2"]);
  });

  it("rejects fetchCatalog when the worker responds with ok:false", async () => {
    const client = createCatalogWorkerClient();
    const promise = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_series" });

    const worker = MockWorker.instances[0];
    worker.respond({ id: worker.posted[0].id, ok: false, error: "boom" });

    await expect(promise).rejects.toThrow("boom");
  });

  it("reuses the same worker instance across multiple calls", () => {
    const client = createCatalogWorkerClient();
    void client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });
    void client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_series" });

    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0].posted).toHaveLength(2);
  });

  it("collapses two identical concurrent fetchCatalog calls into a single worker request (React StrictMode double-invoke)", async () => {
    // Regression test: StrictMode double-invokes effects in dev, so
    // useCachedContent's load() call fires twice on mount. XtreamClient's
    // own requestCache already absorbed this for every direct Xtream call,
    // but this worker path previously had no equivalent — VOD/series
    // catalogs (the two things big enough for a doubled fetch+parse to be
    // felt as a real UI freeze) were fetched twice for every screen visit.
    const client = createCatalogWorkerClient();
    const credentials = { baseUrl: "http://x", username: "u", password: "p" };

    const p1 = client.fetchCatalog({ credentials, action: "get_vod_streams" });
    const p2 = client.fetchCatalog({ credentials, action: "get_vod_streams" });

    const worker = MockWorker.instances[0];
    expect(worker.posted).toHaveLength(1); // only one real postMessage, not two

    worker.respond({ id: worker.posted[0].id, ok: true, data: ["shared-result"] });

    await expect(p1).resolves.toEqual(["shared-result"]);
    await expect(p2).resolves.toEqual(["shared-result"]);
  });

  it("does not dedupe requests with a different action or categoryId", () => {
    const client = createCatalogWorkerClient();
    const credentials = { baseUrl: "http://x", username: "u", password: "p" };

    void client.fetchCatalog({ credentials, action: "get_vod_streams" });
    void client.fetchCatalog({ credentials, action: "get_vod_streams", categoryId: "cat-1" });
    void client.fetchCatalog({ credentials, action: "get_series" });

    expect(MockWorker.instances[0].posted).toHaveLength(3);
  });

  it("evicts a failed request from the dedupe cache so a later retry gets a real new request", async () => {
    const client = createCatalogWorkerClient();
    const credentials = { baseUrl: "http://x", username: "u", password: "p" };

    const first = client.fetchCatalog({ credentials, action: "get_series" });
    const worker = MockWorker.instances[0];
    worker.respond({ id: worker.posted[0].id, ok: false, error: "transient" });
    await expect(first).rejects.toThrow("transient");

    void client.fetchCatalog({ credentials, action: "get_series" });
    expect(worker.posted).toHaveLength(2);
  });

  it("resolves multiple concurrent requests independently by id", async () => {
    const client = createCatalogWorkerClient();
    const p1 = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });
    const p2 = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_series" });

    const worker = MockWorker.instances[0];
    const [req1, req2] = worker.posted;
    worker.respond({ id: req2.id, ok: true, data: ["series-data"] });
    worker.respond({ id: req1.id, ok: true, data: ["vod-data"] });

    await expect(p1).resolves.toEqual(["vod-data"]);
    await expect(p2).resolves.toEqual(["series-data"]);
  });

  it("rejects every pending request when the worker itself errors", async () => {
    const client = createCatalogWorkerClient();
    const p1 = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });
    const p2 = client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_series" });

    MockWorker.instances[0].fail("module load failed");

    await expect(p1).rejects.toThrow("module load failed");
    await expect(p2).rejects.toThrow("module load failed");
  });

  it("terminate() tears down the worker so a later fetchCatalog call creates a new one", () => {
    const client = createCatalogWorkerClient();
    void client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });
    client.terminate();
    void client.fetchCatalog({ credentials: { baseUrl: "http://x", username: "u", password: "p" }, action: "get_vod_streams" });

    expect(MockWorker.instances).toHaveLength(2);
    expect(MockWorker.instances[0].terminated).toBe(true);
  });
});
