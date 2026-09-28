import { describe, expect, it } from "vitest";
import { indexTokens, queryTokens, scoreTitle, stripProviderTags, SCORE_EXACT, SCORE_STARTS_WITH, SCORE_WORDS_ANY_ORDER, SCORE_WORDS_IN_ORDER } from "./normalize.js";

describe("stripProviderTags", () => {
  it.each([
    ["EN | Breaking Bad", "Breaking Bad"],
    ["FR: Amélie", "Amélie"],
    ["en | the office", "the office"],
    ["[4K] Dune", "Dune"],
    ["(MULTI) Dune", "Dune"],
    ["4K - Dune Part Two", "Dune Part Two"],
    ["UHD HD The Matrix", "The Matrix"],
    ["EN | 4K | Avatar", "Avatar"],
    ["VIP: DE | Tatort", "Tatort"],
  ])("%s → %s", (title, expected) => {
    expect(stripProviderTags(title)).toBe(expected);
  });

  it("leaves real words alone", () => {
    expect(stripProviderTags("Up: The Movie")).toBe("Up: The Movie"); // "Up" isn't an upper-case code
    expect(stripProviderTags("Heat")).toBe("Heat");
    expect(stripProviderTags("HD")).toBe("HD"); // a title that is only a tag keeps it
    expect(stripProviderTags("Hdtv Nights")).toBe("Hdtv Nights");
  });
});

describe("tokens", () => {
  it("folds case and accents, splits on punctuation, and drops stopwords", () => {
    expect(indexTokens("EN | The Lord of the Rings: The Return of the King")).toEqual(["lord", "of", "rings", "return", "king"]);
    expect(indexTokens("Amélie")).toEqual(["amelie"]);
    expect(indexTokens("Spider-Man: No Way Home (2021)")).toEqual(["spider", "man", "no", "way", "home", "2021"]);
  });

  it("keeps a title or query made only of stopwords", () => {
    expect(indexTokens("The The")).toEqual(["the"]);
    expect(queryTokens("the")).toEqual(["the"]);
    expect(queryTokens("The Matrix")).toEqual(["matrix"]);
  });
});

describe("scoreTitle", () => {
  const score = (query: string, title: string) => scoreTitle(queryTokens(query), title);

  it("ranks exact, then starts-with, then words in order, then any order", () => {
    expect(score("matrix", "The Matrix")).toBe(SCORE_EXACT);
    expect(score("matrix re", "The Matrix Reloaded")).toBe(SCORE_STARTS_WITH);
    expect(score("mat", "The Matrix")).toBe(SCORE_STARTS_WITH);
    expect(score("breaking b", "EN | Breaking Bad")).toBe(SCORE_STARTS_WITH);
    expect(score("break bad", "EN | Breaking Bad")).toBe(SCORE_WORDS_IN_ORDER); // "break" only starts "breaking"
    expect(score("bad", "EN | Breaking Bad")).toBe(SCORE_WORDS_IN_ORDER);
    expect(score("king return", "The Return of the King")).toBe(SCORE_WORDS_ANY_ORDER);
    expect(score("xyz", "The Matrix")).toBe(0);
    expect(score("atrix", "The Matrix")).toBe(0); // words match from their start only
  });
});
