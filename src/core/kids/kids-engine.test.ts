import { describe, expect, it } from "vitest";
import { decideCategory, decideItem, type ParentSourceRules } from "./eligibility.js";
import { normalize, tokenize } from "./normalize.js";
import { getDefaultKidsRules } from "./rules.js";

const rules = getDefaultKidsRules();

describe("normalize", () => {
  it("folds case, punctuation, emoji and decorations", () => {
    expect(normalize("|FR| ✪ ANIMATION")).toBe("fr animation");
    expect(normalize("UK-Kids 4K")).toBe("uk kids");
    expect(normalize("4K Kids 24/7")).toBe("kids");
    expect(normalize("Kids-Animation")).toBe("kids animation");
  });

  it("keeps + in tokens so 18+ and +18 survive", () => {
    expect(tokenize("Movies (18+)")).toEqual(["movies", "18+"]);
    expect(tokenize("+18 Channel")).toEqual(["+18", "channel"]);
  });

  it("folds Arabic letter variants", () => {
    expect(normalize("أطفال")).toBe(normalize("اطفال"));
  });
});

describe("classifyCategory", () => {
  it("allows the exact category list after normalization", () => {
    expect(rules.classifyCategory("|FR| ✪ ANIMATION").verdict).toBe("allow");
    expect(rules.classifyCategory("KIDS | اطفال").verdict).toBe("allow");
    expect(rules.classifyCategory("Kids - أطفال").verdict).toBe("allow");
  });

  it("allows categories matching an inclusion keyword and tags them", () => {
    const result = rules.classifyCategory("EN: Cartoons");
    expect(result.verdict).toBe("allow");
    expect(result.tags).toContain("animation");
  });

  it("puts review categories in review and blocks the drop list", () => {
    expect(rules.classifyCategory("Disney+").verdict).toBe("review");
    expect(rules.classifyCategory("Adventure Movies").verdict).toBe("review");
    expect(rules.classifyCategory("EN | Documentary").verdict).toBe("block");
    expect(rules.classifyCategory("Documentry").reason).toBe("blocked:documentry");
  });

  it("blocks a mature category even when it also has a kids word", () => {
    expect(rules.classifyCategory("Christmas Horror")).toMatchObject({ verdict: "block", reason: "mature:horror" });
  });

  it("never allows a whole category from a tag-only keyword", () => {
    expect(rules.classifyCategory("Science Fiction").verdict).toBe("none");
    expect(rules.classifyCategory("Anime").verdict).toBe("none");
    expect(rules.classifyCategory("Science for Kids").verdict).toBe("allow");
  });

  it("matches whole words only", () => {
    expect(rules.tagText("Murder in Sussex").mature).toBeNull();
    expect(rules.tagText("Essex Boys").mature).toBeNull();
    expect(rules.tagText("Sex Education").mature).toBe("sex");
    expect(rules.tagText("Young Adult").mature).toBeNull();
  });

  it("catches the adult provider tags", () => {
    for (const name of ["XXX Hits", "Movies +18", "18 Plus Cinema", "Adults Only", "Uncensored Cuts"]) {
      expect(rules.tagText(name).mature, name).not.toBeNull();
    }
  });
});

describe("kids channels", () => {
  it("recognises a known kids channel inside a decorated provider name", () => {
    expect(rules.matchKidsChannel("UK: Nick Jr HD")).toBe("nick jr");
    expect(rules.matchKidsChannel("AR | سبيستون")).toBe("سبيستون");
    expect(rules.matchKidsChannel("BBC One")).toBeNull();
  });
});

describe("matureProgrammeReason", () => {
  it("flags adult ratings, mature keywords and categories", () => {
    expect(rules.matureProgrammeReason({ title: "Late Movie", rating: "TV-MA" })).toBe("rating:TV-MA");
    expect(rules.matureProgrammeReason({ title: "Night Horror Marathon" })).toBe("mature:horror");
    expect(rules.matureProgrammeReason({ title: "Film", categories: ["Erotic"] })).toBe("mature:erotic");
    expect(rules.matureProgrammeReason({ title: "Adult Swim Block" })).toBe("mature:adult swim");
  });

  it("passes ordinary kids programmes", () => {
    expect(rules.matureProgrammeReason({ title: "Peppa Pig", description: "Peppa goes to school", rating: "TV-Y" })).toBeNull();
  });
});

describe("decideItem precedence (§3.3)", () => {
  const kidsCategory = decideCategory(rules, undefined, "vod", "10", "Kids Movies");
  const comedy = decideCategory(rules, undefined, "vod", "20", "Comedy");

  it("default-denies anything without an allowed category", () => {
    expect(decideItem(rules, undefined, false, { kind: "vod", id: "1", name: "Some Film" }, comedy).allowed).toBe(false);
    expect(decideItem(rules, undefined, false, { kind: "vod", id: "1", name: "Some Film" }, undefined).allowed).toBe(false);
  });

  it("includes titles in an allowed category", () => {
    expect(decideItem(rules, undefined, false, { kind: "vod", id: "1", name: "Frozen" }, kidsCategory)).toMatchObject({ allowed: true });
  });

  it("vetoes a mature title even inside an allowed or parent-approved category", () => {
    expect(decideItem(rules, undefined, false, { kind: "vod", id: "1", name: "Christmas Horror Night" }, kidsCategory).allowed).toBe(false);
    const parent: ParentSourceRules = { categories: { vod: { "20": "approve" } } };
    const approved = decideCategory(rules, parent, "vod", "20", "Comedy");
    expect(approved.allowed).toBe(true);
    expect(decideItem(rules, parent, false, { kind: "vod", id: "2", name: "Family Comedy" }, approved).allowed).toBe(true);
    expect(decideItem(rules, parent, false, { kind: "vod", id: "3", name: "Slasher Comedy" }, approved).allowed).toBe(false);
  });

  it("lets the parent's item decision win over everything", () => {
    const parent: ParentSourceRules = { items: { vod: { "1": "include", "2": "exclude" } } };
    expect(decideItem(rules, parent, false, { kind: "vod", id: "1", name: "Horror Classic" }, comedy)).toMatchObject({ allowed: true, reason: "parent:include" });
    expect(decideItem(rules, parent, false, { kind: "vod", id: "2", name: "Frozen" }, kidsCategory)).toMatchObject({ allowed: false, reason: "parent:exclude" });
  });

  it("allows a known kids channel from any category, but not an adult one", () => {
    const entertainment = decideCategory(rules, undefined, "live", "5", "USA Entertainment");
    expect(decideItem(rules, undefined, false, { kind: "live", id: "c1", name: "US: Cartoon Network HD" }, entertainment)).toMatchObject({ allowed: true, reason: "channel:cartoon network" });
    expect(decideItem(rules, undefined, false, { kind: "live", id: "c2", name: "Cartoon Network Adult Swim" }, entertainment).allowed).toBe(false);
  });

  it("treats kid-friendly titles from other categories as allowed only when the parent turns it on", () => {
    const item = { kind: "vod" as const, id: "9", name: "Cartoon Adventures" };
    expect(decideItem(rules, undefined, false, item, comedy).allowed).toBe(false);
    expect(decideItem(rules, undefined, true, item, comedy)).toMatchObject({ allowed: true, fromOtherCategory: true });
    const documentary = decideCategory(rules, undefined, "vod", "30", "Documentary");
    expect(decideItem(rules, undefined, true, item, documentary).allowed).toBe(false);
  });

  it("keeps each Kids profile's decisions separate (AC12)", () => {
    const sibling: ParentSourceRules = { categories: { vod: { "20": "approve" } } };
    expect(decideCategory(rules, sibling, "vod", "20", "Comedy").allowed).toBe(true);
    expect(decideCategory(rules, undefined, "vod", "20", "Comedy").allowed).toBe(false);
  });
});
