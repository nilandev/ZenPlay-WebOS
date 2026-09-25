import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_CHOICES, type Profile } from "@core";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { __resetParentalForTests, getDisclaimerAcknowledgedAt, loadKidsProfileRules, setPin } from "../parental-store.js";
import { PARENTAL_DISCLAIMER, PARENTAL_DISCLAIMER_TITLE } from "./ParentalDisclaimer.js";
import { PinGate } from "./ParentalFlows.js";
import { ParentalControlsScreen } from "./ParentalControlsScreen.js";
import { ProfileForm } from "./ProfileForm.js";
import { ProfilesScreen } from "./ProfilesScreen.js";

function press(key: string, target: Document | Element = document): void {
  act(() => {
    fireEvent.keyDown(target, { key });
    fireEvent.keyUp(target, { key });
  });
}
async function typePin(pin: string): Promise<void> {
  for (const digit of pin) {
    await act(async () => {
      fireEvent.keyDown(document, { key: digit });
    });
  }
}
const focusedId = () => useFocusStore.getState().focusedId;

const parent: Profile = { id: "p1", name: "Alex", avatarUrl: AVATAR_CHOICES[0] };
const kid: Profile = { id: "k1", name: "Mia", avatarUrl: AVATAR_CHOICES[3], kind: "kids" };

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  __resetParentalForTests();
});
afterEach(() => {
  for (const scope of Object.keys(useFocusStore.getState().scopes)) useFocusStore.getState().clearGraph(scope);
});

describe("PinGate", () => {
  it("never shows the keypad in trust mode (AC13)", () => {
    const onUnlock = vi.fn();
    render(<PinGate platform="web" title="Parental Controls" onUnlock={onUnlock} onCancel={() => {}} />);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("asks for the PIN in locked mode; the remote's number keys type it (AC2)", async () => {
    await setPin("2468");
    const onUnlock = vi.fn();
    render(<PinGate platform="web" title="Parental Controls" onUnlock={onUnlock} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();

    await typePin("1111");
    await waitFor(() => expect(screen.getByText(/Wrong PIN · 4 tries left/)).toBeDefined());
    expect(onUnlock).not.toHaveBeenCalled();

    await typePin("2468");
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });

  it("is navigable with the D-pad keypad", async () => {
    await setPin("5555");
    const onUnlock = vi.fn();
    render(<PinGate platform="web" title="Parental Controls" onUnlock={onUnlock} onCancel={() => {}} />);
    expect(focusedId()).toBe("pin-key:5");
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        fireEvent.keyDown(document, { key: "Enter" });
        fireEvent.keyUp(document, { key: "Enter" });
      });
    }
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  });
});

describe("Kids profile setup", () => {
  it("ProfileForm shows the disclaimer while the Kids toggle is on (AC8)", () => {
    const onSave = vi.fn();
    render(<ProfileForm platform="web" title="New Profile" saveLabel="Create" onSave={onSave} onCancel={() => {}} />);
    expect(screen.queryByText(PARENTAL_DISCLAIMER)).toBeNull();
    press("ArrowDown");
    expect(focusedId()).toBe("profile-form-kids");
    press("Enter");
    expect(screen.getByText(PARENTAL_DISCLAIMER_TITLE)).toBeDefined();
    expect(screen.getByText(PARENTAL_DISCLAIMER)).toBeDefined();
    act(() => useFocusStore.getState().focus("profile-form-save"));
    press("Enter");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: "kids" }));
  });

  it("the last parent profile can't become a Kids profile (AC9)", () => {
    render(<ProfileForm platform="web" profile={parent} title="Edit Profile" saveLabel="Save" canBeKids={false} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("At least one parent profile is needed")).toBeDefined();
    press("ArrowDown");
    expect(focusedId()).not.toBe("profile-form-kids");
  });

  it("the first Kids profile shows the disclaimer and an optional PIN; Not now keeps trust mode (AC1)", () => {
    const onCreateProfile = vi.fn();
    render(<ProfilesScreen profiles={[parent]} platform="web" onSelectProfile={() => {}} onCreateProfile={onCreateProfile} onManageProfiles={() => {}} />);
    act(() => useFocusStore.getState().focus("create-profile"));
    press("Enter");
    press("ArrowDown");
    press("Enter"); // Kids profile on
    act(() => useFocusStore.getState().focus("profile-form-save"));
    press("Enter");

    expect(screen.getByText("Protect parent settings with a PIN?")).toBeDefined();
    expect(screen.getByText(PARENTAL_DISCLAIMER)).toBeDefined();
    expect(onCreateProfile).not.toHaveBeenCalled();
    expect(focusedId()).toBe("kids-confirm-set-pin");
    press("ArrowRight");
    press("Enter"); // Not now
    expect(onCreateProfile).toHaveBeenCalledWith(expect.objectContaining({ kind: "kids" }));
    expect(getDisclaimerAcknowledgedAt()).toBeDefined();
  });
});

describe("leaving a Kids profile", () => {
  it("asks for the PIN before a parent profile, not before another Kids profile (AC2)", async () => {
    await setPin("2468");
    const onSelectProfile = vi.fn();
    const kid2: Profile = { ...kid, id: "k2", name: "Leo" };
    render(<ProfilesScreen profiles={[parent, kid, kid2]} platform="web" isLeavingKids onSelectProfile={onSelectProfile} onCreateProfile={() => {}} onManageProfiles={() => {}} />);
    act(() => useFocusStore.getState().focus("k2"));
    press("Enter");
    expect(onSelectProfile).toHaveBeenCalledWith(kid2);

    act(() => useFocusStore.getState().focus("p1"));
    press("Enter");
    expect(screen.getByText("Switch to Alex")).toBeDefined();
    expect(onSelectProfile).toHaveBeenCalledTimes(1);
    await typePin("2468");
    await waitFor(() => expect(onSelectProfile).toHaveBeenCalledWith(parent));
  });

  it("goes straight through in trust mode (AC13)", () => {
    const onSelectProfile = vi.fn();
    render(<ProfilesScreen profiles={[parent, kid]} platform="web" isLeavingKids onSelectProfile={onSelectProfile} onCreateProfile={() => {}} onManageProfiles={() => {}} />);
    press("Enter");
    expect(onSelectProfile).toHaveBeenCalledWith(parent);
  });

  it("guards Manage Profiles while a Kids profile exists and a PIN is set", async () => {
    await setPin("2468");
    const onManageProfiles = vi.fn();
    render(<ProfilesScreen profiles={[parent, kid]} platform="web" onSelectProfile={() => {}} onCreateProfile={() => {}} onManageProfiles={onManageProfiles} />);
    act(() => useFocusStore.getState().focus("manage-profiles"));
    press("Enter");
    expect(screen.getByText("Manage Profiles")).toBeDefined();
    expect(onManageProfiles).not.toHaveBeenCalled();
    await typePin("2468");
    await waitFor(() => expect(onManageProfiles).toHaveBeenCalledTimes(1));
  });
});

describe("ParentalControlsScreen", () => {
  const sources = [{ kind: "m3u-url" as const, id: "s1", name: "Home", url: "http://x/list.m3u" }];

  it("shows the disclaimer footer, the PIN state and saves the cross-category switch at once (AC5, AC8, AC14)", () => {
    render(<ParentalControlsScreen platform="web" profiles={[parent, kid]} sources={sources} activeSourceId="s1" onBack={() => {}} />);
    expect(screen.getByText(PARENTAL_DISCLAIMER)).toBeDefined();
    expect(screen.getByText(/Trust mode: no PIN is set/)).toBeDefined();
    expect(screen.getByText("Set PIN")).toBeDefined();

    act(() => useFocusStore.getState().focus("pc-allow-other"));
    press("Enter");
    expect(loadKidsProfileRules("k1").allowOtherCategories).toBe(true);
  });

  it("explains how to start when there's no Kids profile", () => {
    render(<ParentalControlsScreen platform="web" profiles={[parent]} sources={sources} activeSourceId="s1" onBack={() => {}} />);
    expect(screen.getByText(/No Kids profiles yet/)).toBeDefined();
  });
});
