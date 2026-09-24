import { useEffect, useRef, useState } from "react";
import { AVATAR_CHOICES, type PlatformId, type Profile } from "@core";
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
import { Check, Trash2 } from "lucide-react";

const SCOPE = "profile-form";
const CONFIRM_SCOPE = "profile-form-confirm";
const AVATAR_GRID_COLUMNS = 5;
const AVATAR_SIZE = "10rem";
const NAME_FIELD_ID = "profile-form-name";
const CANCEL_ID = "profile-form-cancel";
const SAVE_ID = "profile-form-save";
const DELETE_ID = "profile-form-delete";
const CONFIRM_KEEP_ID = "profile-form-confirm-keep";
const CONFIRM_DELETE_ID = "profile-form-confirm-delete";

export interface ProfileFormFields {
  name: string;
  avatarUrl: string;
}

export interface ProfileFormProps {
  platform: PlatformId;
  /** Existing profile being edited, or undefined when creating a new one. */
  profile?: Profile;
  title: string;
  saveLabel: string;
  canDelete?: boolean;
  onSave: (fields: ProfileFormFields) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

/**
 * Profile create/edit form — shared by "Who's watching?" → Add Profile and
 * Manage Profiles → edit. TV layout: a large live preview of the avatar and
 * name on the left; the name field, the avatar grid and the actions on the
 * right. Everything is on the remote's focus graph: Name → avatars (a 5-wide
 * grid) → Save / Cancel / Delete in one row.
 */
export function ProfileForm({ platform, profile, title, saveLabel, canDelete, onSave, onDelete, onCancel }: ProfileFormProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  const [draftName, setDraftName] = useState(profile?.name ?? "");
  const [draftAvatar, setDraftAvatar] = useState(profile?.avatarUrl ?? AVATAR_CHOICES[0]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // The graph's closures read drafts and callbacks through refs, so it's
  // only rebuilt when its shape changes — not on every keystroke or parent
  // render (a rebuild while the delete dialog was open used to reset its
  // focus to the first button).
  const draftRef = useRef({ draftName, draftAvatar });
  draftRef.current = { draftName, draftAvatar };
  const callbacksRef = useRef({ onSave, onDelete, onCancel, fallbackName: profile?.name });
  callbacksRef.current = { onSave, onDelete, onCancel, fallbackName: profile?.name };

  function save(): void {
    const { draftName: name, draftAvatar: avatarUrl } = draftRef.current;
    callbacksRef.current.onSave({ name: name.trim() || callbacksRef.current.fallbackName || "New Profile", avatarUrl });
  }
  const saveRef = useRef(save);
  const returnToDeleteRef = useRef(false);
  saveRef.current = save;

  useEffect(() => {
    if (isConfirmingDelete) {
      // Nothing behind the dialog should be reachable.
      returnToDeleteRef.current = true;
      setGraph(SCOPE, []);
      return;
    }
    const row1 = AVATAR_CHOICES.slice(0, AVATAR_GRID_COLUMNS);
    const row2 = AVATAR_CHOICES.slice(AVATAR_GRID_COLUMNS);
    const bottomRow = row2.length > 0 ? row2 : row1;
    const actionIds = [SAVE_ID, CANCEL_ID, ...(canDelete ? [DELETE_ID] : [])];
    // Each action sits under an avatar column: Save/Cancel on the left, Delete far right.
    const actionColumn = (id: string) => (id === DELETE_ID ? bottomRow.length - 1 : actionIds.indexOf(id));

    const avatarNodes: FocusNode[] = AVATAR_CHOICES.map((url, index) => {
      const col = index % AVATAR_GRID_COLUMNS;
      const inRow2 = index >= AVATAR_GRID_COLUMNS;
      const below = inRow2 ? undefined : row2[col];
      return {
        id: url,
        neighbors: {
          up: inRow2 ? row1[col] : NAME_FIELD_ID,
          down: below ?? (col === bottomRow.length - 1 && canDelete ? DELETE_ID : col === 0 ? SAVE_ID : CANCEL_ID),
          left: col > 0 ? AVATAR_CHOICES[index - 1] : undefined,
          right: col < AVATAR_GRID_COLUMNS - 1 ? AVATAR_CHOICES[index + 1] : undefined,
        },
        onSelect: () => setDraftAvatar(url),
      };
    });

    const actionNodes: FocusNode[] = actionIds.map((id, index) => ({
      id,
      neighbors: {
        up: bottomRow[Math.min(actionColumn(id), bottomRow.length - 1)],
        left: actionIds[index - 1],
        right: actionIds[index + 1],
      },
      onSelect:
        id === SAVE_ID ? () => saveRef.current() : id === CANCEL_ID ? () => callbacksRef.current.onCancel() : () => setIsConfirmingDelete(true),
    }));

    // Coming back from the delete dialog, land on Delete again rather than the top.
    const initialFocusId = returnToDeleteRef.current && canDelete ? DELETE_ID : NAME_FIELD_ID;
    returnToDeleteRef.current = false;
    setGraph(
      SCOPE,
      [{ id: NAME_FIELD_ID, neighbors: { down: row1[0] }, onSelect: () => focusTvTextField(NAME_FIELD_ID) }, ...avatarNodes, ...actionNodes],
      initialFocusId,
    );
  }, [isConfirmingDelete, canDelete, setGraph]);

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

  const previewName = draftName.trim() || profile?.name || "New Profile";

  return (
    <MeshBackground>
      <div
        style={{
          minHeight: "100vh",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: "4.5rem",
          padding: `3rem ${BROWSE_SIDE_PADDING}`,
        }}
      >
        <section style={{ width: "30rem", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <img
            src={draftAvatar}
            alt=""
            style={{
              width: "16rem",
              height: "16rem",
              borderRadius: "50%",
              objectFit: "cover",
              boxShadow: "0 0 0 0.3125rem var(--accent), 0 2rem 4rem -1rem rgba(0,0,0,0.7)",
            }}
          />
          <div
            style={{
              marginTop: "2rem",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "2.25rem",
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {previewName}
          </div>
          <h1 style={{ fontSize: TV_TEXT, fontWeight: 500, color: "var(--text-dim)", margin: "0.5rem 0 0" }}>{title}</h1>
        </section>

        <section
          style={{
            flex: 1,
            minWidth: 0,
            padding: "2.5rem 3rem",
            borderRadius: "1.75rem",
            background: "rgba(16,17,23,0.72)",
            boxShadow: "0 2rem 4rem rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          <TvTextField id={NAME_FIELD_ID} label="Name" value={draftName} onChange={setDraftName} platform={platform} placeholder="New Profile" />

          <div style={{ fontSize: TV_TEXT, fontWeight: 600, color: "var(--text-dim)", margin: "2rem 0 1.25rem" }}>Avatar</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${AVATAR_GRID_COLUMNS}, ${AVATAR_SIZE})`, gap: "1.75rem", justifyContent: "space-between" }}>
            {AVATAR_CHOICES.map((url) => (
              <AvatarChoice key={url} url={url} isSelected={draftAvatar === url} onClick={() => setDraftAvatar(url)} />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginTop: "2.75rem" }}>
            <TvButton id={SAVE_ID} label={saveLabel} icon={Check} variant="primary" onSelect={save} />
            <TvButton id={CANCEL_ID} label="Cancel" onSelect={onCancel} />
            {canDelete && (
              <>
                <div style={{ flex: 1 }} />
                <TvButton id={DELETE_ID} label="Delete Profile" icon={Trash2} variant="danger" onSelect={() => setIsConfirmingDelete(true)} />
              </>
            )}
          </div>
        </section>
      </div>
    </MeshBackground>
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
          transform: isFocused ? "scale(1.12)" : "scale(1)",
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
            boxShadow: isFocused
              ? "0 0 0 0.25rem #ffffff, 0 1rem 2rem -0.5rem rgba(0,0,0,0.7)"
              : isSelected
                ? "0 0 0 0.25rem var(--accent)"
                : "none",
            opacity: isFocused || isSelected ? 1 : 0.8,
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
