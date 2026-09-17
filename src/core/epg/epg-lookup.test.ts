import { describe, expect, it } from "vitest";
import { ChannelGuide, buildChannelGuides } from "./epg-lookup.js";
import type { EpgProgramme } from "../models/epg.js";

function programme(channelId: string, startHour: number, endHour: number, title: string): EpgProgramme {
  return {
    channelId,
    title,
    start: new Date(Date.UTC(2024, 0, 1, startHour)),
    stop: new Date(Date.UTC(2024, 0, 1, endHour)),
  };
}

describe("ChannelGuide", () => {
  const programmes = [
    programme("bbc1", 20, 21, "News"),
    programme("bbc1", 19, 20, "Earlier Show"),
    programme("bbc1", 21, 23, "Film"),
  ];

  it("sorts programmes by start time regardless of input order", () => {
    const guide = new ChannelGuide(programmes);
    expect(guide.getProgrammes().map((p) => p.title)).toEqual(["Earlier Show", "News", "Film"]);
  });

  it("returns the correct now/next pair for a given time", () => {
    const guide = new ChannelGuide(programmes);
    const { now, next } = guide.getNowNext(new Date(Date.UTC(2024, 0, 1, 20, 30)));
    expect(now?.title).toBe("News");
    expect(next?.title).toBe("Film");
  });

  it("returns undefined now when the time falls in a gap", () => {
    const guide = new ChannelGuide([programme("bbc1", 19, 20, "A"), programme("bbc1", 21, 22, "B")]);
    const { now, next } = guide.getNowNext(new Date(Date.UTC(2024, 0, 1, 20, 30)));
    expect(now).toBeUndefined();
    expect(next?.title).toBe("B");
  });

  it("returns undefined next when there is no future programme", () => {
    const guide = new ChannelGuide(programmes);
    const { next } = guide.getNowNext(new Date(Date.UTC(2024, 0, 1, 22)));
    expect(next).toBeUndefined();
  });

  it("filters programmes overlapping a time range for the EPG grid", () => {
    const guide = new ChannelGuide(programmes);
    const inRange = guide.getProgrammesInRange(
      new Date(Date.UTC(2024, 0, 1, 19, 30)),
      new Date(Date.UTC(2024, 0, 1, 20, 30)),
    );
    expect(inRange.map((p) => p.title)).toEqual(["Earlier Show", "News"]);
  });
});

describe("buildChannelGuides", () => {
  it("groups programmes by channel id into separate guides", () => {
    const guides = buildChannelGuides([
      programme("bbc1", 19, 20, "A"),
      programme("cnn", 19, 20, "B"),
      programme("bbc1", 20, 21, "C"),
    ]);
    expect(guides.size).toBe(2);
    expect(guides.get("bbc1")?.getProgrammes()).toHaveLength(2);
    expect(guides.get("cnn")?.getProgrammes()).toHaveLength(1);
  });
});
