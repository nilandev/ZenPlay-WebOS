import { useEffect, useRef, useState } from "react";
import { AVATAR_CHOICES, type PlatformId, type Profile, type ProfileKind } from "@core";
import {
  BROWSE_SIDE_PADDING,
  Focusable,
  focusTvTextField,
  MeshBackground,
  TV_TEXT,
  TvButton,
  TvTextField,
  useFocusStore,
  useIsFocused,
  useRemoteInput,
  type FocusNode,
} from "@ui";
import { Check, Pencil, Trash2 } from "lucide-react";
import { ParentalDisclaimer } from "./ParentalDisclaimer.js";

const SCOPE = "profile-form";
const CONFIRM_SCOPE = "profile-form-confirm";
const PICKER_SCOPE = "profile-avatar-picker";
const AVATAR_GRID_COLUMNS = 5;
const AVATAR_SIZE = "11rem";
const HERO_AVATAR_SIZE = "12rem";
const FORM_WIDTH = "44rem";
const AVATAR_ID = "profile-form-avatar";
const NAME_FIELD_ID = "profile-form-name";
const KIDS_TOGGLE_ID = "profile-form-kids";
const CANCEL_ID = "profile-form-cancel";
const SAVE_ID = "profile-form-save";
const DELETE_ID = "profile-form-delete";
const CONFIRM_KEEP_ID = "profile-form-confirm-keep";
const CONFIRM_DELETE_ID = "profile-form-confirm-delete";

export interface ProfileFormFields {
  name: string;
  avatarUrl: string;
  kind: ProfileKind;
}

export interface ProfileFormProps {
  platform: PlatformId;
  /** Existing profile being edited, or undefined when creating a new one. */
  profile?: Profile;
  title: string;
  saveLabel: string;
  /** Name used when the field is left empty on create (e.g. "Profile 3") — shown as the placeholder. */
  defaultName?: string;
  canDelete?: boolean;
  /**
   * False when this is the last standard profile — it can't become a Kids
   * profile, so a parent can always get back in (docs/kids-profile.md §2.1).
   */
  canBeKids?: boolean;
  onSave: (fields: ProfileFormFields) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

/**
 * Profile create/edit form — shared by "Who's watching?" → Add Profile and
 * Manage Profiles → edit. TV layout: one centred column the remote walks
 * straight down — the avatar (OK opens a full-screen picker), Name, Kids
 * profile, then Save / Cancel, with Delete set apart below. The avatar picker
 * and the delete confirmation each take over the screen and their own focus
 * scope; Back closes them.
 */
export function ProfileForm({
  platform,
  profile,
  title,
  saveLabel,
  defaultName = "New Profile",
  canDelete,
  canBeKids = true,
  onSave,
  onDelete,
  onCancel,
}: ProfileFormProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [draftName, setDraftName] = useState(profile?.name ?? "");
  const [draftAvatar, setDraftAvatar] = useState(profile?.avatarUrl ?? AVATAR_CHOICES[0]);
  const [draftKind, setDraftKind] = useState<ProfileKind>(profile?.kind ?? "standard");
  // The toggle is offered unless this is the last standard profile (a Kids profile can always switch back).
  const canToggleKids = canBeKids || draftKind === "kids";
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPickingAvatar, setIsPickingAvatar] = useState(false);

  // The graph's closures read drafts and callbacks through refs, so it's
  // only rebuilt when its shape changes — not on every keystroke or parent
  // render (a rebuild while the delete dialog was open used to reset its
  // focus to the first button).
  const draftRef = useRef({ draftName, draftAvatar, draftKind });
  draftRef.current = { draftName, draftAvatar, draftKind };
  const fallbackName = profile?.name ?? defaultName;
  const callbacksRef = useRef({ onSave, onDelete, onCancel, fallbackName });
  callbacksRef.current = { onSave, onDelete, onCancel, fallbackName };

  function save(): void {
    const { draftName: name, draftAvatar: avatarUrl, draftKind: kind } = draftRef.current;
    callbacksRef.current.onSave({ name: name.trim() || callbacksRef.current.fallbackName, avatarUrl, kind });
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  // Where focus lands when the form comes back from an overlay (the picker or the delete dialog).
  const returnFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (isConfirmingDelete || isPickingAvatar) {
      // Nothing behind the overlay should be reachable.
      returnFocusRef.current = isConfirmingDelete ? DELETE_ID : AVATAR_ID;
      setGraph(SCOPE, []);
      return;
    }
    const aboveActions = canToggleKids ? KIDS_TOGGLE_ID : NAME_FIELD_ID;
    const deleteBelow = canDelete ? DELETE_ID : undefined;
    const nodes: FocusNode[] = [
      { id: AVATAR_ID, neighbors: { down: NAME_FIELD_ID }, onSelect: () => setIsPickingAvatar(true) },
      {
        id: NAME_FIELD_ID,
        neighbors: { up: AVATAR_ID, down: canToggleKids ? KIDS_TOGGLE_ID : SAVE_ID },
        onSelect: () => focusTvTextField(NAME_FIELD_ID),
      },
      ...(canToggleKids
        ? [
            {
              id: KIDS_TOGGLE_ID,
              neighbors: { up: NAME_FIELD_ID, down: SAVE_ID },
              onSelect: () => setDraftKind((kind: ProfileKind) => (kind === "kids" ? "standard" : "kids")),
            },
          ]
        : []),
      { id: SAVE_ID, neighbors: { up: aboveActions, right: CANCEL_ID, down: deleteBelow }, onSelect: () => saveRef.current() },
      { id: CANCEL_ID, neighbors: { up: aboveActions, left: SAVE_ID, down: deleteBelow }, onSelect: () => callbacksRef.current.onCancel() },
      ...(canDelete ? [{ id: DELETE_ID, neighbors: { up: SAVE_ID }, onSelect: () => setIsConfirmingDelete(true) }] : []),
    ];

    const returnTo = returnFocusRef.current;
    returnFocusRef.current = null;
    const initialFocusId = returnTo === AVATAR_ID || (returnTo === DELETE_ID && canDelete) ? returnTo : NAME_FIELD_ID;
    setGraph(SCOPE, nodes, initialFocusId);
  }, [isConfirmingDelete, isPickingAvatar, canDelete, canToggleKids, setGraph]);

  useEffect(() => {
    if (!isPickingAvatar) return;
    const columns = AVATAR_GRID_COLUMNS;
    const lastRow = Math.ceil(AVATAR_CHOICES.length / columns) - 1;
    setGraph(
      PICKER_SCOPE,
      AVATAR_CHOICES.map((url, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        return {
          id: url,
          neighbors: {
            up: AVATAR_CHOICES[index - columns],
            // A short last row: Down from a column with nothing under it lands on the last avatar.
            down: AVATAR_CHOICES[index + columns] ?? (row < lastRow ? AVATAR_CHOICES[AVATAR_CHOICES.length - 1] : undefined),
            left: col > 0 ? AVATAR_CHOICES[index - 1] : undefined,
            right: col < columns - 1 ? AVATAR_CHOICES[index + 1] : undefined,
          },
          onSelect: () => {
            setDraftAvatar(url);
            setIsPickingAvatar(false);
          },
        };
      }),
    );
    focus(draftRef.current.draftAvatar);
    return () => clearGraph(PICKER_SCOPE);
  }, [isPickingAvatar, setGraph, clearGraph, focus]);

  useEffect(() => {
    if (!isConfirmingDelete) return;
    setGraph(CONFIRM_SCOPE, [
      { id: CONFIRM_KEEP_ID, neighbors: { right: CONFIRM_DELETE_ID }, onSelect: () => setIsConfirmingDelete(false) },
      { id: CONFIRM_DELETE_ID, neighbors: { left: CONFIRM_KEEP_ID }, onSelect: () => callbacksRef.current.onDelete?.() },
    ]);
    focus(CONFIRM_KEEP_ID);
    return () => clearGraph(CONFIRM_SCOPE);
  }, [isConfirmingDelete, setGraph, clearGraph, focus]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useRemoteInput(platform, {
    onBack: () => {
      if (isConfirmingDelete) setIsConfirmingDelete(false);
      else if (isPickingAvatar) setIsPickingAvatar(false);
      else onCancel();
    },
  });

  if (isConfirmingDelete) {
    return (
      <MeshBackground>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: `3rem ${BROWSE_SIDE_PADDING}` }}>
          <div
            style={{
              textAlign: "center",
              maxWidth: "56rem",
              padding: "3.5rem 4rem",
              borderRadius: "1.75rem",
              background: "rgba(16,17,23,0.92)",
              boxShadow: "0 2rem 4rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)",
            }}
          >
            <img src={draftAvatar} alt="" style={{ width: "7rem", height: "7rem", borderRadius: "50%", objectFit: "cover" }} />
            <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: "1.25rem 0 1rem" }}>Delete “{profile?.name}”?</h1>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0 0 2.5rem", lineHeight: 1.5 }}>
              This removes the profile with its My List and watch history. This can't be undone.
            </p>
            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center" }}>
              <TvButton id={CONFIRM_KEEP_ID} label="Keep Profile" onSelect={() => setIsConfirmingDelete(false)} />
              <TvButton id={CONFIRM_DELETE_ID} label="Delete" icon={Trash2} variant="danger" onSelect={() => onDelete?.()} />
            </div>
          </div>
        </div>
      </MeshBackground>
    );
  }

  if (isPickingAvatar) {
    return (
      <MeshBackground>
        <div
          style={{
            minHeight: "100vh",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: `3rem ${BROWSE_SIDE_PADDING}`,
          }}
        >
          <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>Choose an avatar</h1>
          <p style={{ fontSize: "1.5rem", color: "var(--text-dim)", margin: "0.75rem 0 3.5rem" }}>Press OK to pick · Back to keep the current one</p>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${AVATAR_GRID_COLUMNS}, ${AVATAR_SIZE})`, gap: "3rem 3.5rem" }}>
            {AVATAR_CHOICES.map((url) => (
              <AvatarChoice
                key={url}
                url={url}
                isSelected={draftAvatar === url}
                onClick={() => {
                  setDraftAvatar(url);
                  setIsPickingAvatar(false);
                }}
              />
            ))}
          </div>
        </div>
      </MeshBackground>
    );
  }

  const isKids = draftKind === "kids";
  const subtitle = profile ? "Change the name, avatar or who this profile is for." : "Add a profile for someone else who watches.";

  return (
    <MeshBackground>
      <div
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: `3rem ${BROWSE_SIDE_PADDING}`,
        }}
      >
        <div style={{ width: FORM_WIDTH, maxWidth: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>{title}</h1>
          <p style={{ fontSize: "1.5rem", color: "var(--text-dim)", margin: "0.5rem 0 2.25rem" }}>{subtitle}</p>

          <HeroAvatar url={draftAvatar} isKids={isKids} onClick={() => setIsPickingAvatar(true)} />

          <div style={{ width: "100%", marginTop: "2.25rem" }}>
            <TvTextField id={NAME_FIELD_ID} label="Name" value={draftName} onChange={setDraftName} platform={platform} placeholder={fallbackName} />

            <KidsToggle isOn={isKids} isAvailable={canToggleKids} onToggle={() => setDraftKind((kind) => (kind === "kids" ? "standard" : "kids"))} />
            {isKids && (
              <div style={{ marginTop: "1rem" }}>
                <ParentalDisclaimer compact />
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: "1.25rem", marginTop: "2.5rem" }}>
            <TvButton id={SAVE_ID} label={saveLabel} icon={Check} variant="primary" onSelect={save} />
            <TvButton id={CANCEL_ID} label="Cancel" onSelect={onCancel} />
          </div>
          {canDelete && (
            <div style={{ marginTop: "1.5rem" }}>
              <TvButton id={DELETE_ID} label="Delete Profile" icon={Trash2} variant="danger" onSelect={() => setIsConfirmingDelete(true)} />
            </div>
          )}
        </div>
      </div>
    </MeshBackground>
  );
}

/** The large avatar at the top of the form — it is the live preview and, on OK, opens the avatar picker. */
function HeroAvatar({ url, isKids, onClick }: { url: string; isKids: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(AVATAR_ID);

  return (
    <Focusable id={AVATAR_ID} style={{ width: HERO_AVATAR_SIZE, height: HERO_AVATAR_SIZE }}>
      <button
        type="button"
        aria-label="Change avatar"
        onClick={onClick}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: "transparent",
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <img
          src={url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            objectFit: "cover",
            display: "block",
            boxShadow: isFocused ? "0 0 0 0.25rem #ffffff, 0 1.5rem 3rem -0.75rem rgba(0,0,0,0.75)" : "0 1.5rem 3rem -0.75rem rgba(0,0,0,0.7)",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: "0.25rem",
            bottom: "0.25rem",
            width: "3rem",
            height: "3rem",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isFocused ? "#ffffff" : "rgba(16,17,23,0.9)",
            color: isFocused ? "#0b0c10" : "#ffffff",
            boxShadow: "0 0.25rem 0.75rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.15)",
          }}
        >
          <Pencil size="1.375rem" strokeWidth={2.5} />
        </span>
        {isKids && (
          <span
            style={{
              position: "absolute",
              left: "50%",
              bottom: "-0.75rem",
              transform: "translateX(-50%)",
              padding: "0.25rem 0.875rem",
              borderRadius: 999,
              fontSize: "1rem",
              fontWeight: 800,
              letterSpacing: "0.08em",
              background: "var(--accent)",
              color: "#062028",
            }}
          >
            KIDS
          </span>
        )}
      </button>
    </Focusable>
  );
}

function AvatarChoice({ url, isSelected, onClick }: { url: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(url);

  return (
    <Focusable id={url} style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onClick}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          padding: 0,
          border: "none",
          borderRadius: "50%",
          background: "transparent",
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <img
          src={url}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            objectFit: "cover",
            display: "block",
            boxShadow: isFocused ? "0 0 0 0.25rem #ffffff, 0 1rem 2rem -0.5rem rgba(0,0,0,0.7)" : "none",
          }}
        />
        {isSelected && (
          <span
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: "2.5rem",
              height: "2.5rem",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--accent)",
              boxShadow: "0 0.25rem 0.75rem rgba(0,0,0,0.5)",
            }}
          >
            <Check size="1.5rem" strokeWidth={3} color="#062028" />
          </span>
        )}
      </button>
    </Focusable>
  );
}

/** "Kids profile" switch — a Kids profile only sees content the Kids filter or a parent allows. */
function KidsToggle({ isOn, isAvailable, onToggle }: { isOn: boolean; isAvailable: boolean; onToggle: () => void }): JSX.Element {
  const isFocused = useIsFocused(KIDS_TOGGLE_ID);
  const row = (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label="Kids profile"
      disabled={!isAvailable}
      onClick={isAvailable ? onToggle : undefined}
      style={{
        marginTop: "1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1.5rem",
        width: "100%",
        padding: "1rem 1.5rem",
        border: "none",
        borderRadius: "1rem",
        background: isFocused ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.07)",
        color: isFocused ? "#0b0c10" : "#ffffff",
        textAlign: "left",
        opacity: isAvailable ? 1 : 0.55,
        cursor: isAvailable ? "pointer" : "default",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: TV_TEXT, fontWeight: 700 }}>Kids profile</span>
        <span style={{ fontSize: "1.125rem", color: isFocused ? "rgba(11,12,16,0.65)" : "rgba(235,236,242,0.6)" }}>
          {isAvailable ? "Only shows channels, movies and series suitable for children" : "At least one parent profile is needed"}
        </span>
      </span>
      <span
        aria-hidden
        style={{
          position: "relative",
          flexShrink: 0,
          width: "4.25rem",
          height: "2.375rem",
          borderRadius: 999,
          background: isOn ? "var(--accent, #38bdf8)" : isFocused ? "rgba(11,12,16,0.2)" : "rgba(255,255,255,0.18)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "0.25rem",
            left: isOn ? "2.125rem" : "0.25rem",
            width: "1.875rem",
            height: "1.875rem",
            borderRadius: "50%",
            background: "#ffffff",
            transition: "left 160ms ease-out",
          }}
        />
      </span>
    </button>
  );
  if (!isAvailable) return row;
  return (
    <Focusable id={KIDS_TOGGLE_ID} style={{ height: "auto" }}>
      {row}
    </Focusable>
  );
}
