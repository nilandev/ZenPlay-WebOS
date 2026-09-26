import { describe, expect, it } from "vitest";
import { sortNewestFirst } from "./catalog-records.js";

describe("sortNewestFirst", () => {
  it("orders by descending numeric stream id, not string order", () => {
    const sorted = sortNewestFirst([{ id: "9" }, { id: "100000" }, { id: "10" }, { id: "99999" }]);
    expect(sorted.map((item) => item.id)).toEqual(["100000", "99999", "10", "9"]);
  });
});
