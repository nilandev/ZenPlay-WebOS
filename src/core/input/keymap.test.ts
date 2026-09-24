import { describe, expect, it } from "vitest";
import { resolveDigitKey, resolveRemoteAction } from "./keymap.js";

function makeEvent(init: Partial<KeyboardEvent> & { key?: string; code?: string; keyCode?: number }): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: init.key ?? "" });
  // keyCode is deprecated and read-only on real KeyboardEvent instances —
  // jsdom's constructor doesn't accept it, so it's patched on afterward,
  // matching how real (if unreliable) browser-reported values arrive.
  Object.defineProperty(event, "keyCode", { value: init.keyCode ?? 0, configurable: true });
  if (init.code !== undefined) Object.defineProperty(event, "code", { value: init.code, configurable: true });
  return event;
}

describe("resolveRemoteAction — webOS back key", () => {
  it("resolves back via the documented keyCode 461", () => {
    const event = makeEvent({ keyCode: 461 });
    expect(resolveRemoteAction("webos", event)).toBe("back");
  });

  it("falls back to event.key when keyCode is unreliable (0) but key reports a back-like value", () => {
    // Reported real-world failure mode: some webOS firmware/remote
    // combinations don't populate the deprecated keyCode property
    // reliably — see conversation history ("back buttons are not working
    // in all pages").
    const event = makeEvent({ keyCode: 0, key: "GoBack" });
    expect(resolveRemoteAction("webos", event)).toBe("back");
  });

  it("falls back to event.code when both keyCode and key are unreliable", () => {
    const event = makeEvent({ keyCode: 0, key: "Unidentified", code: "BrowserBack" });
    expect(resolveRemoteAction("webos", event)).toBe("back");
  });

  it("still resolves back via the standard-key fallback (Escape/Backspace) on webOS", () => {
    const event = makeEvent({ keyCode: 0, key: "Escape" });
    expect(resolveRemoteAction("webos", event)).toBe("back");
  });

  it("does not misclassify an unrelated key as back", () => {
    const event = makeEvent({ keyCode: 13, key: "Enter" });
    expect(resolveRemoteAction("webos", event)).toBe("select");
  });
});

describe("resolveRemoteAction — standard (web) platform", () => {
  it("maps arrow keys, Enter, and Escape/Backspace as before", () => {
    expect(resolveRemoteAction("web", makeEvent({ key: "ArrowUp" }))).toBe("up");
    expect(resolveRemoteAction("web", makeEvent({ key: "ArrowDown" }))).toBe("down");
    expect(resolveRemoteAction("web", makeEvent({ key: "ArrowLeft" }))).toBe("left");
    expect(resolveRemoteAction("web", makeEvent({ key: "ArrowRight" }))).toBe("right");
    expect(resolveRemoteAction("web", makeEvent({ key: "Enter" }))).toBe("select");
    expect(resolveRemoteAction("web", makeEvent({ key: "Escape" }))).toBe("back");
    expect(resolveRemoteAction("web", makeEvent({ key: "Backspace" }))).toBe("back");
  });

  it("returns unknown for an unrecognized key", () => {
    expect(resolveRemoteAction("web", makeEvent({ key: "F5" }))).toBe("unknown");
  });

  it("still resolves the webOS back keyCode even when platform is reported as 'web'", () => {
    // Regression test: the webOS TV Simulator's Magic Remote panel was
    // confirmed (via on-device logging) to dispatch a real keyCode 461
    // "GoBack" event while window.webOS is absent, so detectPlatform()
    // reports "web" — meaning the platform-gated webOS check never ran and
    // Back silently did nothing. See conversation history ("back buttons
    // are not working in all pages").
    const event = makeEvent({ keyCode: 461, key: "GoBack" });
    expect(resolveRemoteAction("web", event)).toBe("back");
  });
});

describe("resolveRemoteAction — media keys", () => {
  it("maps standard media key values", () => {
    expect(resolveRemoteAction("web", makeEvent({ key: "MediaPlay" }))).toBe("play");
    expect(resolveRemoteAction("web", makeEvent({ key: "MediaPause" }))).toBe("pause");
    expect(resolveRemoteAction("web", makeEvent({ key: "MediaStop" }))).toBe("stop");
    expect(resolveRemoteAction("web", makeEvent({ key: "MediaRewind" }))).toBe("rewind");
    expect(resolveRemoteAction("web", makeEvent({ key: "MediaFastForward" }))).toBe("fast-forward");
  });

  it("maps LG remote keyCodes when webOS doesn't report a key value", () => {
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 415 }))).toBe("play");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 19 }))).toBe("pause");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 413 }))).toBe("stop");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 412 }))).toBe("rewind");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 417 }))).toBe("fast-forward");
  });

  it("doesn't read LG keyCodes on the web keymap", () => {
    expect(resolveRemoteAction("web", makeEvent({ key: "Unidentified", keyCode: 19 }))).toBe("unknown");
  });
});

describe("channel keys", () => {
  it("maps CH+/CH− (and LG's PageUp/PageDown codes) to channel up/down", () => {
    expect(resolveRemoteAction("web", makeEvent({ key: "ChannelUp" }))).toBe("channel-up");
    expect(resolveRemoteAction("web", makeEvent({ key: "PageDown" }))).toBe("channel-down");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 33 }))).toBe("channel-up");
    expect(resolveRemoteAction("webos", makeEvent({ key: "Unidentified", keyCode: 34 }))).toBe("channel-down");
  });

  it("reads digit keys by key or keyCode, including the keypad", () => {
    expect(resolveDigitKey(makeEvent({ key: "7" }))).toBe(7);
    expect(resolveDigitKey(makeEvent({ key: "Unidentified", keyCode: 50 }))).toBe(2);
    expect(resolveDigitKey(makeEvent({ key: "Unidentified", keyCode: 105 }))).toBe(9);
    expect(resolveDigitKey(makeEvent({ key: "a", keyCode: 65 }))).toBeNull();
  });
});
