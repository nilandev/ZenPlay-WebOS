import { describe, expect, it } from "vitest";
import { cleanTitle } from "./clean-title.js";

describe("cleanTitle", () => {
  it("drops the empty brackets a panel leaves for a missing year", () => {
    expect(cleanTitle("Heat ()")).toBe("Heat");
    expect(cleanTitle("Heat ( )")).toBe("Heat");
    expect(cleanTitle("EN | Heat () [4K]")).toBe("EN | Heat [4K]");
    expect(cleanTitle("Heat []")).toBe("Heat");
  });

  it("leaves real bracketed text alone", () => {
    expect(cleanTitle("Heat (1995)")).toBe("Heat (1995)");
    expect(cleanTitle("Up (Director's Cut)")).toBe("Up (Director's Cut)");
  });

  it("trims the ends and never returns an empty title", () => {
    expect(cleanTitle("  Heat  ")).toBe("Heat");
    expect(cleanTitle("()")).toBe("()");
    expect(cleanTitle(undefined)).toBe("");
  });
});
