import { describe, expect, it } from "vitest";
import { parseXmltv, parseXmltvTimestamp, parseXmltvToArray } from "./parse-xmltv.js";

describe("parseXmltvTimestamp", () => {
  it("parses timestamps with a timezone offset", () => {
    const date = parseXmltvTimestamp("20240115203000 +0000");
    expect(date.toISOString()).toBe("2024-01-15T20:30:00.000Z");
  });

  it("parses timestamps without an offset as UTC", () => {
    const date = parseXmltvTimestamp("20240115203000");
    expect(date.toISOString()).toBe("2024-01-15T20:30:00.000Z");
  });

  it("throws on malformed timestamps", () => {
    expect(() => parseXmltvTimestamp("not-a-date")).toThrow();
  });
});

describe("parseXmltv", () => {
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <programme start="20240115200000 +0000" stop="20240115203000 +0000" channel="bbc1.uk">
    <title>News at Ten</title>
    <desc>The day's headlines &amp; more.</desc>
  </programme>
  <programme start="20240115203000 +0000" stop="20240115220000 +0000" channel="bbc1.uk">
    <title>Film Night</title>
  </programme>
</tv>`;

  it("yields one entry per programme block", () => {
    const programmes = parseXmltvToArray(sample);
    expect(programmes).toHaveLength(2);
  });

  it("extracts title, description, and decodes entities", () => {
    const [first] = parseXmltvToArray(sample);
    expect(first.title).toBe("News at Ten");
    expect(first.description).toBe("The day's headlines & more.");
    expect(first.channelId).toBe("bbc1.uk");
  });

  it("handles missing <desc> gracefully", () => {
    const [, second] = parseXmltvToArray(sample);
    expect(second.title).toBe("Film Night");
    expect(second.description).toBeUndefined();
  });

  it("skips malformed programme blocks missing required attributes", () => {
    const malformed = `<tv><programme channel="x"><title>No times</title></programme></tv>`;
    expect(parseXmltvToArray(malformed)).toEqual([]);
  });

  it("is a lazy generator that can be iterated incrementally", () => {
    const iterator = parseXmltv(sample);
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(first.value.title).toBe("News at Ten");
  });
});

describe("parseXmltv resilience", () => {
  it("skips a programme with a malformed timestamp and keeps going", () => {
    const xml = `<tv>
      <programme start="not-a-date" stop="20240115210000 +0000" channel="a"><title>Broken</title></programme>
      <programme start="20240115203000 +0000" stop="20240115210000 +0000" channel="a"><title>Fine</title></programme>
    </tv>`;
    expect(parseXmltvToArray(xml).map((p) => p.title)).toEqual(["Fine"]);
  });
});

describe("parseXmltv — Kids check fields", () => {
  it("keeps <category> values and the <rating> value", () => {
    const xml = `<tv><programme start="20240115200000 +0000" stop="20240115210000 +0000" channel="c1"><title>Late Film</title><category lang="en">Movie</category><category>Horror</category><rating system="VCHIP"><value>TV-MA</value></rating></programme></tv>`;
    const [programme] = parseXmltvToArray(xml);
    expect(programme.categories).toEqual(["Movie", "Horror"]);
    expect(programme.rating).toBe("TV-MA");
  });

  it("leaves them unset when the guide has none", () => {
    const xml = `<tv><programme start="20240115200000 +0000" stop="20240115210000 +0000" channel="c1"><title>News</title></programme></tv>`;
    const [programme] = parseXmltvToArray(xml);
    expect(programme).not.toHaveProperty("categories");
    expect(programme).not.toHaveProperty("rating");
  });
});
