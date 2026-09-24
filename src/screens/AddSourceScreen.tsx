import { useEffect, useMemo, useRef, useState } from "react";
import type { PlatformId, PlaylistSource } from "@core";
import { Focusable, useFocusStore, useRemoteInput, type FocusNode, useIsFocused } from "@ui";
import { Radio, Rss } from "lucide-react";

export interface AddSourceScreenProps {
  onSourceAdded: (source: PlaylistSource) => void;
  /** Omitted on first-run setup (no existing source to fall back to); provided when reused inside Manage Playlists to add an additional source. */
  onCancel?: () => void;
  platform: PlatformId;
}

const SCOPE = "add-source";
const TAB_XTREAM_ID = "add-source-tab-xtream";
const TAB_M3U_ID = "add-source-tab-m3u";
const FIELD_NAME_ID = "add-source-field-name";
const FIELD_URL_ID = "add-source-field-url";
const FIELD_USERNAME_ID = "add-source-field-username";
const FIELD_PASSWORD_ID = "add-source-field-password";
const FIELD_M3U_URL_ID = "add-source-field-m3u-url";
const SUBMIT_ID = "add-source-submit";
const CANCEL_ID = "add-source-cancel";

/**
 * First-run setup: add an Xtream Codes provider or an M3U playlist URL. Also
 * reused inside ManagePlaylistsScreen's "Add playlist" flow (onCancel is
 * only passed there). The mode tabs and buttons are D-pad navigable via the
 * spatial-nav Focusable/focus-store system like every other screen; the text
 * fields themselves stay plain native inputs (not Focusable tiles) since
 * text entry on TV remotes goes through the on-screen keyboard the webOS
 * runtime provides natively when a native input receives DOM focus —
 * useRemoteInput already lets arrow/select keys fall through to it while
 * typing.
 */
export function AddSourceScreen({ onSourceAdded, onCancel, platform }: AddSourceScreenProps): JSX.Element {
  const [mode, setMode] = useState<"xtream" | "m3u-url">("xtream");
  const [name, setName] = useState("My Provider");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");

  const nameInputRef = useRef<HTMLInputElement>(null);
  const baseUrlInputRef = useRef<HTMLInputElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const m3uUrlInputRef = useRef<HTMLInputElement>(null);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  // Re-registering the graph on every keystroke would momentarily clear and
  // re-create this screen's scope (clearGraph nulls focusedId when it's the
  // only scope registered), kicking focus back to its initial node while
  // typing. Reading the latest field values via a ref in handleSubmit —
  // instead of depending on them in the graph effect below — keeps the graph
  // (and focus) stable while typing and only rebuilds it when the graph's
  // actual shape changes (mode/onCancel).
  const latestRef = useRef({ mode, name, baseUrl, username, password, m3uUrl });
  latestRef.current = { mode, name, baseUrl, username, password, m3uUrl };

  function handleSubmit(): void {
    const id = crypto.randomUUID();
    const current = latestRef.current;

    if (current.mode === "xtream") {
      onSourceAdded({ kind: "xtream", id, name: current.name, baseUrl: current.baseUrl, username: current.username, password: current.password });
    } else {
      onSourceAdded({ kind: "m3u-url", id, name: current.name, url: current.m3uUrl });
    }
  }

  // Field ids for the current mode, in visual order, so the graph and the
  // "select a field to focus its input" map can be built from one list.
  const fieldIds = useMemo(
    () =>
      mode === "xtream"
        ? [FIELD_NAME_ID, FIELD_URL_ID, FIELD_USERNAME_ID, FIELD_PASSWORD_ID]
        : [FIELD_NAME_ID, FIELD_M3U_URL_ID],
    [mode],
  );

  // setGraph re-registers this scope's node map in place, so calling it
  // again when the mode tab changes (via a plain effect, not a mount/unmount
  // pair) preserves whatever's currently focused. clearGraph only runs once,
  // on true unmount below — calling it on every mode change would null
  // focusedId first (this screen is the sole scope) and then setGraph's own
  // "keep current focus if still valid" check would have nothing to keep,
  // falling back to the hardcoded initial tab and fighting D-pad/click
  // navigation into the other tab.
  useEffect(() => {
    const tabNodes: FocusNode[] = [
      { id: TAB_XTREAM_ID, neighbors: { right: TAB_M3U_ID, down: fieldIds[0] }, onSelect: () => setMode("xtream") },
      { id: TAB_M3U_ID, neighbors: { left: TAB_XTREAM_ID, down: fieldIds[0] }, onSelect: () => setMode("m3u-url") },
    ];

    const fieldNodes: FocusNode[] = fieldIds.map((id, index) => ({
      id,
      neighbors: {
        up: index > 0 ? fieldIds[index - 1] : TAB_XTREAM_ID,
        down: index < fieldIds.length - 1 ? fieldIds[index + 1] : SUBMIT_ID,
      },
      onSelect: () => focusNativeInput(id),
    }));

    const actionNodes: FocusNode[] = [
      {
        id: SUBMIT_ID,
        neighbors: { up: fieldIds[fieldIds.length - 1], down: onCancel ? CANCEL_ID : undefined },
        onSelect: () => handleSubmit(),
      },
      ...(onCancel
        ? [{ id: CANCEL_ID, neighbors: { up: SUBMIT_ID }, onSelect: onCancel } satisfies FocusNode]
        : []),
    ];

    setGraph(SCOPE, [...tabNodes, ...fieldNodes, ...actionNodes], TAB_XTREAM_ID);
  }, [fieldIds, setGraph, onCancel]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  function focusNativeInput(fieldId: string): void {
    const refs: Record<string, React.RefObject<HTMLInputElement>> = {
      [FIELD_NAME_ID]: nameInputRef,
      [FIELD_URL_ID]: baseUrlInputRef,
      [FIELD_USERNAME_ID]: usernameInputRef,
      [FIELD_PASSWORD_ID]: passwordInputRef,
      [FIELD_M3U_URL_ID]: m3uUrlInputRef,
    };
    refs[fieldId]?.current?.focus();
  }

  useRemoteInput(platform, { onBack: onCancel });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4rem",
        backgroundImage: "radial-gradient(circle at 50% 0%, rgba(56,189,248,0.1), transparent 60%)",
      }}
    >
      <div style={{ width: "40rem", maxWidth: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div
            style={{
              width: "4.5rem",
              height: "4.5rem",
              margin: "0 auto 1.25rem",
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(160deg, rgba(56,189,248,0.22) 0%, rgba(56,189,248,0.06) 100%)",
              border: "1px solid rgba(56,189,248,0.35)",
            }}
          >
            <Radio size="2rem" strokeWidth={1.75} color="var(--accent)" />
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, margin: 0 }}>Add your playlist</h1>
          <p style={{ marginTop: "0.5rem", fontSize: "1.125rem", color: "var(--text-dim)" }}>
            Connect an Xtream Codes provider or an M3U playlist URL
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <ModeTab
            id={TAB_XTREAM_ID}
            icon={Radio}
            label="Xtream Codes"
            active={mode === "xtream"}
            onClick={() => {
              setMode("xtream");
              focus(TAB_XTREAM_ID);
            }}
          />
          <ModeTab
            id={TAB_M3U_ID}
            icon={Rss}
            label="M3U Playlist"
            active={mode === "m3u-url"}
            onClick={() => {
              setMode("m3u-url");
              focus(TAB_M3U_ID);
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.125rem" }}>
          <Field id={FIELD_NAME_ID} label="Playlist name">
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => focus(FIELD_NAME_ID)}
              style={inputStyle}
            />
          </Field>

          {mode === "xtream" ? (
            <>
              <Field id={FIELD_URL_ID} label="Server URL">
                <input
                  ref={baseUrlInputRef}
                  placeholder="http://host:port"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onFocus={() => focus(FIELD_URL_ID)}
                  style={inputStyle}
                />
              </Field>
              <Field id={FIELD_USERNAME_ID} label="Username">
                <input
                  ref={usernameInputRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => focus(FIELD_USERNAME_ID)}
                  style={inputStyle}
                />
              </Field>
              <Field id={FIELD_PASSWORD_ID} label="Password">
                <input
                  ref={passwordInputRef}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => focus(FIELD_PASSWORD_ID)}
                  style={inputStyle}
                />
              </Field>
            </>
          ) : (
            <Field id={FIELD_M3U_URL_ID} label="Playlist URL">
              <input
                ref={m3uUrlInputRef}
                placeholder="https://example.com/playlist.m3u8"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                onFocus={() => focus(FIELD_M3U_URL_ID)}
                style={inputStyle}
              />
            </Field>
          )}

          <ActionButton id={SUBMIT_ID} onClick={handleSubmit} variant="primary">
            Save &amp; Continue
          </ActionButton>

          {onCancel && (
            <ActionButton id={CANCEL_ID} onClick={onCancel} variant="secondary">
              Cancel
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", fontSize: "1.125rem", padding: "0.875rem 1rem" };

function ModeTab({
  id,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  id: string;
  icon: typeof Radio;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto", flex: 1 }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.625rem",
          padding: "0.875rem 0",
          borderRadius: "0.625rem",
          border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid var(--border)",
          background: active
            ? "var(--surface-raised)"
            : isFocused
              ? "rgba(255,255,255,0.06)"
              : "var(--surface)",
          color: active || isFocused ? "var(--text)" : "var(--text-dim)",
          fontWeight: active ? 700 : 500,
          fontSize: "1rem",
          boxShadow: isFocused
            ? "0 0 0 0.1875rem var(--accent), 0 0.625rem 1.25rem -0.5rem rgba(0,0,0,0.55)"
            : "none",
          transform: isFocused ? "scale(1.03)" : "scale(1)",
          transition: "transform 180ms ease-out, box-shadow 180ms ease-out, background 180ms ease-out, border-color 180ms ease-out",
          cursor: "pointer",
        }}
      >
        <Icon size="1.125rem" strokeWidth={1.75} color={active ? "var(--accent)" : "currentColor"} />
        {label}
      </button>
    </Focusable>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          fontSize: "0.9375rem",
          color: isFocused ? "var(--text)" : "var(--text-dim)",
          borderRadius: "0.75rem",
          padding: "0.375rem",
          boxShadow: isFocused ? "0 0 0 0.1875rem var(--accent)" : "0 0 0 0.1875rem transparent",
          transition: "box-shadow 180ms ease-out, color 180ms ease-out",
        }}
      >
        {label}
        {children}
      </label>
    </Focusable>
  );
}

function ActionButton({
  id,
  onClick,
  variant,
  children,
}: {
  id: string;
  onClick: () => void;
  variant: "primary" | "secondary";
  children: React.ReactNode;
}): JSX.Element {
  const isFocused = useIsFocused(id);
  const isPrimary = variant === "primary";
  return (
    <Focusable id={id} style={{ height: "auto", marginTop: isPrimary ? "0.625rem" : 0 }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          padding: "1rem 0",
          borderRadius: "0.625rem",
          border: isPrimary ? "none" : isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid var(--border)",
          background: isPrimary ? "var(--accent)" : isFocused ? "rgba(255,255,255,0.06)" : "transparent",
          color: isPrimary ? "#062028" : isFocused ? "var(--text)" : "var(--text-dim)",
          fontWeight: isPrimary ? 700 : 600,
          fontSize: isPrimary ? "1.0625rem" : "0.9375rem",
          boxShadow: isFocused
            ? `0 0 0 0.1875rem ${isPrimary ? "#ffffff" : "var(--accent)"}, 0 0.625rem 1.25rem -0.5rem rgba(0,0,0,0.55)`
            : "none",
          transform: isFocused ? "scale(1.02)" : "scale(1)",
          transition: "transform 180ms ease-out, box-shadow 180ms ease-out, background 180ms ease-out",
          cursor: "pointer",
        }}
      >
        {children}
      </button>
    </Focusable>
  );
}
