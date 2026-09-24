import { afterEach, describe, expect, it, vi } from "vitest";

async function loadPerfTier(): Promise<typeof import("./perf-tier.js")> {
  vi.resetModules();
  return import("./perf-tier.js");
}

describe("perf-tier", () => {
  afterEach(() => {
    localStorage.removeItem("zenplay.liteEffects");
    delete (window as unknown as { webOS?: unknown }).webOS;
  });

  it("keeps full effects in a plain browser", async () => {
    const { LITE_EFFECTS, glassBlur } = await loadPerfTier();
    expect(LITE_EFFECTS).toBe(false);
    expect(glassBlur("blur(16px)")).toEqual({ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" });
  });

  it("switches to lite effects inside the webOS runtime, dropping backdrop blur", async () => {
    (window as unknown as { webOS?: unknown }).webOS = {};
    const { LITE_EFFECTS, glassBlur } = await loadPerfTier();
    expect(LITE_EFFECTS).toBe(true);
    expect(glassBlur("blur(16px)")).toEqual({});
  });

  it("honours the localStorage override in either direction", async () => {
    localStorage.setItem("zenplay.liteEffects", "1");
    expect((await loadPerfTier()).LITE_EFFECTS).toBe(true);

    (window as unknown as { webOS?: unknown }).webOS = {};
    localStorage.setItem("zenplay.liteEffects", "0");
    expect((await loadPerfTier()).LITE_EFFECTS).toBe(false);
  });
});
