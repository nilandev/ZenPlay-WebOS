import { beforeEach, describe, expect, it } from "vitest";
import type { PlaylistSource } from "@core";
import { addPlaylistSource, forgetProfileSource, playlistForProfile, rememberProfileSource, removePlaylistSource } from "./playlist-store.js";

const a: PlaylistSource = { kind: "m3u-url", id: "a", name: "A", url: "http://a/list.m3u" };
const b: PlaylistSource = { kind: "m3u-url", id: "b", name: "B", url: "http://b/list.m3u" };

describe("per-profile playlist memory", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the playlist each profile last used", () => {
    rememberProfileSource("mum", "a");
    rememberProfileSource("kid", "b");
    expect(playlistForProfile("mum", [a, b])).toBe("a");
    expect(playlistForProfile("kid", [a, b])).toBe("b");
    expect(playlistForProfile("guest", [a, b])).toBeNull(); // nothing remembered: keep whatever is active
  });

  it("ignores a remembered playlist that no longer exists", () => {
    rememberProfileSource("mum", "gone");
    expect(playlistForProfile("mum", [a, b])).toBeNull();
  });

  it("forgets a removed playlist for every profile, and a deleted profile entirely", () => {
    addPlaylistSource(a);
    addPlaylistSource(b);
    rememberProfileSource("mum", "b");
    rememberProfileSource("kid", "a");
    removePlaylistSource("b");
    expect(playlistForProfile("mum", [a, b])).toBeNull();
    expect(playlistForProfile("kid", [a])).toBe("a");

    forgetProfileSource("kid");
    expect(playlistForProfile("kid", [a])).toBeNull();
  });
});
