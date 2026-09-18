import { forwardRef, useEffect, useRef, useState } from "react";
import { AVATAR_CHOICES, type PlatformId, type Profile } from "@core";
import { Focusable, MeshBackground, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { Trash2 } from "lucide-react";

const AVATAR_GRID_COLUMNS = 5;
const NAME_FIELD_ID = "profile-form-name";
const CANCEL_ID = "profile-form-cancel";
const SAVE_ID = "profile-form-save";
const DELETE_ID = "profile-form-delete";
const CONFIRM_KEEP_ID = "profile-form-confirm-keep";
const CONFIRM_DELETE_ID = "profile-form-confirm-delete";

function useIsFocused(id: string): boolean {
  return useFocusStore((state) => state.focusedId === id);
}

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
 * Full-screen, D-pad-navigable profile create/edit form — shared by
 * ProfilesScreen's "New profile" flow and ManageProfilesScreen's "Edit
 * profile" flow. Previously two near-identical, non-TV-navigable centered
 * web-form cards: only the avatar grid was wired into the focus graph, so
 * the Name field and every button (Cancel/Save/Delete) were unreachable via
 * remote — see conversation history. Every control here is a full-width
 * focusable row so arrow-key navigation flows straight down the screen,
 * matching the rest of the app's TV layout language (large glass tiles,
 * generous spacing) instead of a cramped centered form card.
 */
export function ProfileForm({ platform, profile, title, saveLabel, canDelete, onSave, onDelete, onCancel }: ProfileFormProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [draftName, setDraftName] = useState(profile?.name ?? "");
  const [draftAvatar, setDraftAvatar] = useState(profile?.avatarUrl ?? AVATAR_CHOICES[0]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // draftName/draftAvatar and the callback props are all read through refs
  // inside the focus-graph onSelect closures below, so the graph-building
  // effect only needs to re-run when the confirm mode or canDelete flag
  // changes — not on every keystroke or every parent render (an unstable
  // callback prop identity previously caused the delete-confirm dialog's
  // focus graph to re-register on every keypress, silently resetting focus
  // back to the first button each time — see conversation history for the
  // full trace of that bug).
  const draftRef = useRef({ draftName, draftAvatar });
  draftRef.current = { draftName, draftAvatar };
  const callbacksRef = useRef({ onSave, onDelete, onCancel });
  callbacksRef.current = { onSave, onDelete, onCancel };

  useEffect(() => {
    if (isConfirmingDelete) return;
    const avatarIds = AVATAR_CHOICES;
    const avatarRow1 = avatarIds.slice(0, AVATAR_GRID_COLUMNS);
    const avatarRow2 = avatarIds.slice(AVATAR_GRID_COLUMNS);

    const nameNode: FocusNode = {
      id: NAME_FIELD_ID,
      neighbors: { down: avatarRow1[0] },
      onSelect: () => nameInputRef.current?.focus(),
    };

    const avatarNodes: FocusNode[] = avatarIds.map((url, index) => {
      const col = index % AVATAR_GRID_COLUMNS;
      const inRow2 = index >= AVATAR_GRID_COLUMNS;
      const isLastRow = inRow2 || avatarRow2.length === 0;
      return {
        id: url,
        neighbors: {
          up: inRow2 ? avatarRow1[col] : NAME_FIELD_ID,
          down: isLastRow ? (canDelete ? DELETE_ID : CANCEL_ID) : (avatarRow2[col] ?? (canDelete ? DELETE_ID : CANCEL_ID)),
          left: col > 0 ? avatarIds[index - 1] : undefined,
          right: col < AVATAR_GRID_COLUMNS - 1 && index + 1 < avatarIds.length ? avatarIds[index + 1] : undefined,
        },
        onSelect: () => setDraftAvatar(url),
      };
    });

    const actionUpNeighbor = avatarRow2[0] ?? avatarRow1[0];

    function buildFields(): ProfileFormFields {
      const { draftName: name, draftAvatar: avatarUrl } = draftRef.current;
      return { name: name.trim() || profile?.name || "New Profile", avatarUrl };
    }

    // All three action buttons sit in one visual row (Delete on the left,
    // Cancel/Save on the right) — neighbors must be horizontal to match,
    // not vertical (an earlier version wired Delete→down→Cancel, which
    // didn't match the actual side-by-side layout and left ArrowRight from
    // Delete with no effect).
    const actionNodes: FocusNode[] = canDelete
      ? [
          { id: DELETE_ID, neighbors: { up: actionUpNeighbor, right: CANCEL_ID }, onSelect: () => setIsConfirmingDelete(true) },
          { id: CANCEL_ID, neighbors: { up: actionUpNeighbor, left: DELETE_ID, right: SAVE_ID }, onSelect: () => callbacksRef.current.onCancel() },
          { id: SAVE_ID, neighbors: { up: actionUpNeighbor, left: CANCEL_ID }, onSelect: () => callbacksRef.current.onSave(buildFields()) },
        ]
      : [
          { id: CANCEL_ID, neighbors: { up: actionUpNeighbor, right: SAVE_ID }, onSelect: () => callbacksRef.current.onCancel() },
          { id: SAVE_ID, neighbors: { up: actionUpNeighbor, left: CANCEL_ID }, onSelect: () => callbacksRef.current.onSave(buildFields()) },
        ];

    setGraph("profile-form", [nameNode, ...avatarNodes, ...actionNodes], NAME_FIELD_ID);
    return () => clearGraph("profile-form");
  }, [isConfirmingDelete, canDelete, setGraph, clearGraph, profile?.name]);

  useEffect(() => {
    if (!isConfirmingDelete) return;
    const nodes: FocusNode[] = [
      { id: CONFIRM_KEEP_ID, neighbors: { right: CONFIRM_DELETE_ID }, onSelect: () => setIsConfirmingDelete(false) },
      { id: CONFIRM_DELETE_ID, neighbors: { left: CONFIRM_KEEP_ID }, onSelect: () => callbacksRef.current.onDelete?.() },
    ];
    setGraph("profile-form-confirm", nodes, CONFIRM_KEEP_ID);
    // setGraph only defaults focus to a scope's first node when the
    // currently focused id is no longer valid anywhere — the form scope
    // underneath is still registered with a valid focused id, so focus must
    // be forced into the dialog explicitly (see conversation history).
    focus(CONFIRM_KEEP_ID);
    return () => clearGraph("profile-form-confirm");
  }, [isConfirmingDelete, setGraph, clearGraph, focus]);

  useRemoteInput(platform, {
    onBack: () => {
      if (isConfirmingDelete) setIsConfirmingDelete(false);
      else onCancel();
    },
  });

  if (isConfirmingDelete) {
    return (
      <MeshBackground>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
          <div style={{ textAlign: "center", maxWidth: 560 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Delete "{profile?.name}"?</h1>
            <p style={{ fontSize: 16, color: "var(--text-dim)", marginBottom: 40, lineHeight: 1.5 }}>
              This removes the profile and its favourites and watch history. This can't be undone.
            </p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <Focusable id={CONFIRM_KEEP_ID}>
                <ConfirmButton id={CONFIRM_KEEP_ID} label="Keep profile" onClick={() => setIsConfirmingDelete(false)} />
              </Focusable>
              <Focusable id={CONFIRM_DELETE_ID}>
                <ConfirmButton id={CONFIRM_DELETE_ID} label="Delete" danger onClick={() => onDelete?.()} />
              </Focusable>
            </div>
          </div>
        </div>
      </MeshBackground>
    );
  }

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 48px", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: "50%",
              overflow: "hidden",
              border: "3px solid var(--accent)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            }}
          >
            <img src={draftAvatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>{title}</h1>
        </div>

        <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 28 }}>
          <Focusable id={NAME_FIELD_ID}>
            <NameField ref={nameInputRef} value={draftName} onChange={setDraftName} />
          </Focusable>

          <div>
            <div style={{ fontSize: 15, color: "var(--text-dim)", marginBottom: 12, fontWeight: 600 }}>Avatar</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${AVATAR_GRID_COLUMNS}, 1fr)`, gap: 16 }}>
              {AVATAR_CHOICES.map((url) => (
                <Focusable key={url} id={url}>
                  <AvatarChoice url={url} isSelected={draftAvatar === url} onClick={() => setDraftAvatar(url)} />
                </Focusable>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 12, alignItems: "center" }}>
            {canDelete && (
              <>
                <Focusable id={DELETE_ID}>
                  <DeleteButton onClick={() => setIsConfirmingDelete(true)} />
                </Focusable>
                <div style={{ flex: 1 }} />
              </>
            )}
            <div style={canDelete ? undefined : { flex: 1 }}>
              <Focusable id={CANCEL_ID}>
                <FormActionButton id={CANCEL_ID} label="Cancel" onClick={onCancel} fill={!canDelete} />
              </Focusable>
            </div>
            <div style={canDelete ? undefined : { flex: 1 }}>
              <Focusable id={SAVE_ID}>
                <FormActionButton
                  id={SAVE_ID}
                  label={saveLabel}
                  primary
                  fill={!canDelete}
                  onClick={() => onSave({ name: draftName.trim() || profile?.name || "New Profile", avatarUrl: draftAvatar })}
                />
              </Focusable>
            </div>
          </div>
        </div>
      </div>
    </MeshBackground>
  );
}

const NameField = forwardRef<HTMLInputElement, { value: string; onChange: (value: string) => void }>(function NameField(
  { value, onChange },
  ref,
) {
  const isFocused = useIsFocused(NAME_FIELD_ID);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 24px",
        borderRadius: 18,
        border: isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.14)",
        background: isFocused
          ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
          : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
        boxShadow: isFocused ? "0 0 0 3px var(--accent), 0 12px 28px -8px rgba(0,0,0,0.5)" : "none",
        transition: "box-shadow 160ms ease-out, border-color 160ms ease-out",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Name</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "transparent", border: "none", outline: "none", padding: 0, fontSize: 22, fontWeight: 600, color: "var(--text)" }}
      />
    </div>
  );
});

function AvatarChoice({ url, isSelected, onClick }: { url: string; isSelected: boolean; onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(url);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        aspectRatio: "1 / 1",
        borderRadius: "50%",
        overflow: "hidden",
        padding: 0,
        border: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
        boxShadow: isFocused
          ? "0 0 0 3px var(--accent), 0 0 24px 4px rgba(110,231,255,0.5)"
          : isSelected
            ? "0 0 0 1px rgba(110,231,255,0.4)"
            : "none",
        transform: isFocused ? "scale(1.08)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, border-color 160ms ease-out",
        cursor: "pointer",
      }}
    >
      <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </button>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }): JSX.Element {
  const isFocused = useIsFocused(DELETE_ID);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "14px 24px",
        borderRadius: 999,
        border: isFocused ? "1px solid rgba(255,107,107,0.7)" : "1px solid rgba(255,107,107,0.25)",
        background: isFocused ? "rgba(255,107,107,0.15)" : "transparent",
        color: "var(--danger)",
        fontSize: 15,
        fontWeight: 600,
        boxShadow: isFocused ? "0 0 0 3px rgba(255,107,107,0.4)" : "none",
        transform: isFocused ? "scale(1.04)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        cursor: "pointer",
      }}
    >
      <Trash2 size={17} strokeWidth={2} />
      Delete profile
    </button>
  );
}

function FormActionButton({
  id,
  label,
  onClick,
  primary,
  fill,
}: {
  id: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** Fill the width of its flex: 1 wrapper — used to split the row 50/50 with its sibling (New Profile's Cancel/Create, with no Delete button competing for space). */
  fill?: boolean;
}): JSX.Element {
  const isFocused = useIsFocused(id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...(fill ? { width: "100%" } : { minWidth: 140 }),
        padding: fill ? "18px 28px" : "14px 28px",
        borderRadius: 999,
        border: primary ? "none" : isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
        background: primary
          ? "var(--accent)"
          : isFocused
            ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
            : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
        backdropFilter: primary ? undefined : "blur(16px) saturate(140%)",
        WebkitBackdropFilter: primary ? undefined : "blur(16px) saturate(140%)",
        color: primary ? "#062028" : "var(--text)",
        fontSize: 15,
        fontWeight: 700,
        boxShadow: isFocused ? `0 0 0 3px var(--accent)${primary ? ", 0 12px 28px -8px rgba(0,0,0,0.5)" : ""}` : "none",
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ConfirmButton({ id: _id, label, onClick, danger }: { id: string; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  const isFocused = useIsFocused(_id);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: 160,
        padding: "14px 28px",
        borderRadius: 999,
        border: danger ? "none" : isFocused ? "1px solid rgba(255,255,255,0.6)" : "1px solid rgba(255,255,255,0.16)",
        background: danger
          ? "var(--danger)"
          : isFocused
            ? "linear-gradient(160deg, rgba(70,74,84,0.75) 0%, rgba(38,40,48,0.8) 100%)"
            : "linear-gradient(160deg, rgba(55,58,68,0.5) 0%, rgba(28,30,36,0.55) 100%)",
        backdropFilter: danger ? undefined : "blur(16px) saturate(140%)",
        WebkitBackdropFilter: danger ? undefined : "blur(16px) saturate(140%)",
        color: danger ? "#2a0a0a" : "var(--text)",
        fontSize: 15,
        fontWeight: 700,
        boxShadow: isFocused ? "0 0 0 3px var(--accent)" : "none",
        transform: isFocused ? "scale(1.05)" : "scale(1)",
        transition: "transform 160ms ease-out, box-shadow 160ms ease-out, background 160ms ease-out",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
