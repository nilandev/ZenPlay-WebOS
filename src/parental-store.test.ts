import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetParentalForTests,
  acknowledgeDisclaimer,
  checkPin,
  getDisclaimerAcknowledgedAt,
  getLockoutRemainingMs,
  getParentSourceRules,
  loadKidsProfileRules,
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  removeKidsProfileRules,
  removePin,
  removeSourceKidsRules,
  requiresPin,
  setAllowOtherCategories,
  setCategoryDecision,
  setItemDecision,
  setPin,
  subscribeParental,
} from "./parental-store.js";
import { hashPin, sha256, verifyPin } from "./pin-hash.js";

beforeEach(() => {
  localStorage.clear();
  __resetParentalForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pin-hash", () => {
  it("computes SHA-256 correctly", () => {
    const hex = Array.from(sha256(new TextEncoder().encode("abc")), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("never stores the PIN and verifies it with the fallback hash", async () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(7) });
    const stored = await hashPin("1234");
    expect(stored.algo).toBe("sha256-iter");
    expect(JSON.stringify(stored)).not.toContain("1234");
    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("4321", stored)).toBe(false);
  });
});

describe("parent PIN", () => {
  it("is optional: trust mode never requires it and any attempt passes", async () => {
    expect(requiresPin()).toBe(false);
    expect(await checkPin("0000")).toEqual({ ok: true });
  });

  it("locks parent areas once set, and back to trust mode when removed", async () => {
    await setPin("2468");
    expect(requiresPin()).toBe(true);
    expect(localStorage.getItem("iptv.parental.v1")).not.toContain("2468");
    expect(await checkPin("2468")).toEqual({ ok: true });
    removePin();
    expect(requiresPin()).toBe(false);
  });

  it("locks out after MAX_PIN_ATTEMPTS wrong PINs, persistently, until the cooldown ends", async () => {
    await setPin("2468");
    const start = 1_000_000;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      expect(await checkPin("0000", start)).toMatchObject({ ok: false, attemptsLeft: MAX_PIN_ATTEMPTS - i, lockedForMs: 0 });
    }
    expect(await checkPin("0000", start)).toMatchObject({ ok: false, lockedForMs: PIN_LOCKOUT_MS });
    // Even the right PIN fails during the lockout — and the lockout is read back from storage.
    expect(await checkPin("2468", start + 1000)).toMatchObject({ ok: false });
    expect(getLockoutRemainingMs(start + 1000)).toBe(PIN_LOCKOUT_MS - 1000);
    expect(await checkPin("2468", start + PIN_LOCKOUT_MS + 1)).toEqual({ ok: true });
  });
});

describe("disclaimer", () => {
  it("records when a parent acknowledged it", () => {
    expect(getDisclaimerAcknowledgedAt()).toBeUndefined();
    acknowledgeDisclaimer(new Date("2026-09-25T10:00:00Z"));
    expect(getDisclaimerAcknowledgedAt()).toBe("2026-09-25T10:00:00.000Z");
  });
});

describe("Kids profile rules", () => {
  it("saves each decision immediately, per profile and playlist, and notifies", () => {
    const listener = vi.fn();
    subscribeParental(listener);
    setCategoryDecision("kid1", "src", "vod", "20", "approve");
    setItemDecision("kid1", "src", "live", "ch9", "exclude");
    setAllowOtherCategories("kid1", true);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getParentSourceRules("kid1", "src")).toEqual({ categories: { vod: { "20": "approve" } }, items: { live: { ch9: "exclude" } } });
    expect(loadKidsProfileRules("kid1").allowOtherCategories).toBe(true);
    // Another Kids profile is untouched (AC12).
    expect(getParentSourceRules("kid2", "src")).toBeUndefined();
  });

  it("clears a decision with null", () => {
    setCategoryDecision("kid1", "src", "vod", "20", "approve");
    setCategoryDecision("kid1", "src", "vod", "20", null);
    expect(getParentSourceRules("kid1", "src")?.categories?.vod).toEqual({});
  });

  it("drops rules for a deleted profile or a removed playlist (AC9)", () => {
    setCategoryDecision("kid1", "a", "vod", "1", "approve");
    setCategoryDecision("kid1", "b", "vod", "1", "approve");
    setCategoryDecision("kid2", "a", "vod", "1", "approve");
    removeSourceKidsRules("a");
    expect(getParentSourceRules("kid1", "a")).toBeUndefined();
    expect(getParentSourceRules("kid1", "b")).toBeDefined();
    removeKidsProfileRules("kid1");
    expect(loadKidsProfileRules("kid1")).toEqual({ sources: {} });
  });
});
