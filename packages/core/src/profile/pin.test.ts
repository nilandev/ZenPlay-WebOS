import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin.js";

describe("pin hashing", () => {
  it("produces a 64-char hex SHA-256 digest", async () => {
    const hash = await hashPin("1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    expect(await hashPin("1234")).toBe(await hashPin("1234"));
  });

  it("produces different hashes for different PINs", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("4321"));
  });

  it("verifyPin succeeds for a matching PIN and fails otherwise", async () => {
    const hash = await hashPin("9999");
    expect(await verifyPin("9999", hash)).toBe(true);
    expect(await verifyPin("0000", hash)).toBe(false);
  });
});
