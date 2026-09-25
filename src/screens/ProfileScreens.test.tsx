import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVATAR_CHOICES, type Profile } from "@core";
import { useFocusStore } from "../ui/focus/focus-store.js";
import { ProfilesScreen } from "./ProfilesScreen.js";
import { ManageProfilesScreen } from "./ManageProfilesScreen.js";
import { ProfileForm } from "./ProfileForm.js";

function press(key: string, target: Document | Element = document): void {
  act(() => {
    fireEvent.keyDown(target, { key });
    fireEvent.keyUp(target, { key });
  });
}
const focusedId = () => useFocusStore.getState().focusedId;

const profiles: Profile[] = [
  { id: "p1", name: "Alex", avatarUrl: AVATAR_CHOICES[0] },
  { id: "p2", name: "Kids", avatarUrl: AVATAR_CHOICES[3] },
];

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  for (const scope of ["content", "manage-grid", "profile-form", "profile-form-confirm"]) useFocusStore.getState().clearGraph(scope);
});

describe("Who's watching?", () => {
  it("OK on a profile picks it; Down reaches Manage Profiles", () => {
    const onSelectProfile = vi.fn();
    const onManageProfiles = vi.fn();
    render(<ProfilesScreen profiles={profiles} platform="web" onSelectProfile={onSelectProfile} onCreateProfile={() => {}} onManageProfiles={onManageProfiles} />);
    expect(focusedId()).toBe("p1");
    press("ArrowRight");
    press("Enter");
    expect(onSelectProfile).toHaveBeenCalledWith(profiles[1]);
    press("ArrowDown");
    expect(focusedId()).toBe("manage-profiles");
    press("Enter");
    expect(onManageProfiles).toHaveBeenCalledTimes(1);
  });

  it("Add Profile opens the form and creates the profile with the chosen avatar", () => {
    const onCreateProfile = vi.fn();
    render(<ProfilesScreen profiles={profiles} platform="web" onSelectProfile={() => {}} onCreateProfile={onCreateProfile} onManageProfiles={() => {}} />);
    act(() => useFocusStore.getState().focus("create-profile"));
    press("Enter");
    expect(screen.getByText("New Profile", { selector: "h1" })).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Name/, { selector: "input" }), { target: { value: "  Sam " } });
    press("ArrowDown"); // Name → Kids profile toggle
    expect(focusedId()).toBe("profile-form-kids");
    press("ArrowDown"); // → first avatar
    press("ArrowRight");
    press("Enter"); // choose the second avatar
    press("ArrowDown");
    press("ArrowDown"); // bottom avatar row, second column → Cancel (the button under it)
    expect(focusedId()).toBe("profile-form-cancel");
    press("ArrowLeft");
    expect(focusedId()).toBe("profile-form-save");
    press("Enter");
    expect(onCreateProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Sam", avatarUrl: AVATAR_CHOICES[1] }));
    expect(onCreateProfile.mock.calls[0][0].kind).toBeUndefined(); // a standard profile
  });
});

describe("Manage Profiles", () => {
  it("OK on a profile opens its edit form; Done goes back", () => {
    const onBack = vi.fn();
    render(<ManageProfilesScreen profiles={profiles} platform="web" onBack={onBack} onUpdateProfile={() => {}} onDeleteProfile={() => {}} />);
    press("ArrowDown");
    expect(focusedId()).toBe("manage-profiles-done");
    press("Enter");
    expect(onBack).toHaveBeenCalledTimes(1);

    press("ArrowUp");
    press("Enter");
    expect(screen.getByText("Edit Profile", { selector: "h1" })).toBeDefined();
  });
});

describe("ProfileForm", () => {
  it("Delete asks first; Keep returns focus to Delete; confirming deletes", () => {
    const onDelete = vi.fn();
    render(<ProfileForm platform="web" profile={profiles[1]} title="Edit Profile" saveLabel="Save" canDelete onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />);
    act(() => useFocusStore.getState().focus("profile-form-delete"));
    press("Enter");
    expect(screen.getByText("Delete “Kids”?")).toBeDefined();
    expect(focusedId()).toBe("profile-form-confirm-keep");

    press("Enter");
    expect(screen.queryByText("Delete “Kids”?")).toBeNull();
    expect(focusedId()).toBe("profile-form-delete");
    expect(onDelete).not.toHaveBeenCalled();

    press("Enter");
    press("ArrowRight");
    press("Enter");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Back while typing the name closes the keyboard, not the form", () => {
    const onCancel = vi.fn();
    render(<ProfileForm platform="web" profile={profiles[0]} title="Edit Profile" saveLabel="Save" onSave={() => {}} onCancel={onCancel} />);
    expect(focusedId()).toBe("profile-form-name");
    press("Enter");
    const input = screen.getByLabelText(/Name/, { selector: "input" });
    expect(document.activeElement).toBe(input);
    press("Escape", input);
    expect(document.activeElement).not.toBe(input);
    expect(onCancel).not.toHaveBeenCalled();
    press("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
