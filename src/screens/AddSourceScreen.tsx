import { useEffect, useMemo, useRef, useState } from "react";
import type { PlatformId, PlaylistSource } from "@core";
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
import { Check, LoaderCircle, Radio, Rss, type LucideIcon } from "lucide-react";
import { setCachedContent } from "../content-cache.js";
import { validateSource } from "../validate-source.js";

export interface AddSourceScreenProps {
  onSourceAdded: (source: PlaylistSource) => void;
  /** Omitted on first-run setup (no existing source to fall back to); provided when reused inside Manage Playlists to add an additional source. */
  onCancel?: () => void;
  platform: PlatformId;
}

type Mode = "xtream" | "m3u-url";

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
const SAVE_ANYWAY_ID = "add-source-save-anyway";

const tabIdFor = (mode: Mode) => (mode === "xtream" ? TAB_XTREAM_ID : TAB_M3U_ID);
const looksLikeUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/**
 * Add an Xtream Codes provider or an M3U playlist URL — first-run setup, and
 * Manage Playlists' "Add Playlist" (onCancel is only passed there).
 *
 * TV layout: the playlist type on the left as two large choice cards, the
 * form on the right (TvTextField handles typing with the remote).
 *
 * Submitting checks the source against the provider first (see
 * validate-source.ts) and only saves it once that passes. While it runs the
 * submit button shows "Connecting…" and focus is pinned to it; Back cancels
 * the check and returns to the form. When the server simply didn't answer,
 * "Save anyway" lets the user keep the source (the provider may just be down).
 */
export function AddSourceScreen({ onSourceAdded, onCancel, platform }: AddSourceScreenProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("xtream");
  const [name, setName] = useState("My Provider");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [error, setError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  // The source that failed validation for a possibly-transient reason — set means "Save anyway" is offered for exactly this source.
  const [saveAnywaySource, setSaveAnywaySource] = useState<PlaylistSource | null>(null);
  const validationRef = useRef<AbortController | null>(null);
  // Where focus goes once a failed check hands the form back — applied after the graph effect restores the fields (focus() ignores ids not in the graph).
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => () => validationRef.current?.abort(), []);

  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const focus = useFocusStore((state) => state.focus);

  // The graph effect below only depends on the form's shape, not its values
  // (re-registering on every keystroke is wasted work), so submit reads the
  // latest values through a ref.
  const latestRef = useRef({ mode, name, baseUrl, username, password, m3uUrl });
  latestRef.current = { mode, name, baseUrl, username, password, m3uUrl };

  function clearFeedback(): void {
    setError("");
    setSaveAnywaySource(null);
  }

  function handleSubmit(): void {
    if (validationRef.current) return; // already connecting
    const current = latestRef.current;
    const trimmed = {
      name: current.name.trim() || (current.mode === "xtream" ? "My Provider" : "My Playlist"),
      baseUrl: current.baseUrl.trim(),
      username: current.username.trim(),
      m3uUrl: current.m3uUrl.trim(),
    };

    const problem: [string, string] | null =
      current.mode === "xtream"
        ? !trimmed.baseUrl
          ? [FIELD_URL_ID, "Enter your provider's server URL."]
          : !looksLikeUrl(trimmed.baseUrl)
            ? [FIELD_URL_ID, "The server URL should start with http:// or https://"]
            : !trimmed.username
              ? [FIELD_USERNAME_ID, "Enter your username."]
              : !current.password
                ? [FIELD_PASSWORD_ID, "Enter your password."]
                : null
        : !trimmed.m3uUrl
          ? [FIELD_M3U_URL_ID, "Enter the playlist URL."]
          : !looksLikeUrl(trimmed.m3uUrl)
            ? [FIELD_M3U_URL_ID, "The playlist URL should start with http:// or https://"]
            : null;

    if (problem) {
      setError(problem[1]);
      focus(problem[0]);
      return;
    }

    clearFeedback();
    const id = crypto.randomUUID();
    const source: PlaylistSource =
      current.mode === "xtream"
        ? { kind: "xtream", id, name: trimmed.name, baseUrl: trimmed.baseUrl, username: trimmed.username, password: current.password }
        : { kind: "m3u-url", id, name: trimmed.name, url: trimmed.m3uUrl };

    const controller = new AbortController();
    validationRef.current = controller;
    setIsValidating(true);
    focus(SUBMIT_ID);

    validateSource(source, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          // Seed the footer's name/expiry so Home can show it without a second login round-trip.
          setCachedContent(`playlist-info:${source.id}`, { name: source.name, expiresAt: result.expiresAt }, "playlist-info");
          onSourceAdded(source);
          return;
        }
        setError(result.message);
        setSaveAnywaySource(result.canSaveAnyway ? source : null);
        if (result.reason === "auth") pendingFocusRef.current = current.mode === "xtream" ? FIELD_USERNAME_ID : FIELD_M3U_URL_ID;
        else if (!result.canSaveAnyway && result.reason !== "account") pendingFocusRef.current = current.mode === "xtream" ? FIELD_URL_ID : FIELD_M3U_URL_ID;
      })
      .catch(() => {
        // Aborted by Back/unmount — cancelConnecting already reset the form.
      })
      .finally(() => {
        if (validationRef.current !== controller) return;
        validationRef.current = null;
        setIsValidating(false);
      });
  }

  function cancelConnecting(): void {
    validationRef.current?.abort();
    validationRef.current = null;
    setIsValidating(false);
  }

  function handleSaveAnyway(): void {
    if (saveAnywaySource) onSourceAdded(saveAnywaySource);
  }
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  const handleSaveAnywayRef = useRef(handleSaveAnyway);
  handleSaveAnywayRef.current = handleSaveAnyway;

  const fieldIds = useMemo(
    () => (mode === "xtream" ? [FIELD_NAME_ID, FIELD_URL_ID, FIELD_USERNAME_ID, FIELD_PASSWORD_ID] : [FIELD_NAME_ID, FIELD_M3U_URL_ID]),
    [mode],
  );

  function chooseMode(next: Mode): void {
    setMode(next);
    clearFeedback();
    focus(FIELD_NAME_ID); // the type is picked — straight on to the form
  }

  // setGraph replaces the scope in place, so rebuilding when the mode
  // changes keeps focus; clearing happens only on unmount.
  const canSaveAnyway = saveAnywaySource !== null;

  useEffect(() => {
    if (isValidating) {
      // Pinned to the button showing "Connecting…" — nothing else is actionable until the check finishes or Back cancels it.
      setGraph(SCOPE, [{ id: SUBMIT_ID, neighbors: {} }], SUBMIT_ID);
      return;
    }
    const activeTab = tabIdFor(mode);
    const actionIds = [SUBMIT_ID, ...(canSaveAnyway ? [SAVE_ANYWAY_ID] : []), ...(onCancel ? [CANCEL_ID] : [])];
    const actionActions: Record<string, () => void> = {
      [SUBMIT_ID]: () => handleSubmitRef.current(),
      [SAVE_ANYWAY_ID]: () => handleSaveAnywayRef.current(),
      [CANCEL_ID]: () => onCancel?.(),
    };
    const nodes: FocusNode[] = [
      { id: TAB_XTREAM_ID, neighbors: { down: TAB_M3U_ID, right: FIELD_NAME_ID }, onSelect: () => chooseMode("xtream") },
      { id: TAB_M3U_ID, neighbors: { up: TAB_XTREAM_ID, right: FIELD_NAME_ID }, onSelect: () => chooseMode("m3u-url") },
      ...fieldIds.map((id, index) => ({
        id,
        neighbors: {
          up: index > 0 ? fieldIds[index - 1] : undefined,
          down: index < fieldIds.length - 1 ? fieldIds[index + 1] : SUBMIT_ID,
          left: activeTab,
        },
        onSelect: () => focusTvTextField(id),
      })),
      ...actionIds.map((id, index) => ({
        id,
        neighbors: { up: fieldIds[fieldIds.length - 1], left: actionIds[index - 1] ?? activeTab, right: actionIds[index + 1] },
        onSelect: actionActions[id],
      })),
    ];
    setGraph(SCOPE, nodes, TAB_XTREAM_ID);
    if (pendingFocusRef.current) {
      focus(pendingFocusRef.current);
      pendingFocusRef.current = null;
    }
    // chooseMode only calls stable store/state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fieldIds, setGraph, onCancel, isValidating, canSaveAnyway]);

  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useRemoteInput(platform, { onBack: isValidating ? cancelConnecting : onCancel });

  function field(id: string, label: string, value: string, setValue: (value: string) => void, extra?: { placeholder?: string; type?: "password" }) {
    return (
      <TvTextField
        id={id}
        label={label}
        value={value}
        platform={platform}
        onChange={(next) => {
          setValue(next);
          if (error) clearFeedback();
        }}
        {...extra}
      />
    );
  }

  const isFirstRun = !onCancel;

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
        <section style={{ width: "36rem", flexShrink: 0 }}>
          <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0, lineHeight: 1.15 }}>
            {isFirstRun ? "Add your playlist" : "Add a Playlist"}
          </h1>
          <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.75rem 0 2.5rem", lineHeight: 1.5 }}>
            {isFirstRun ? "Connect your TV provider to start watching." : "Connect another provider or playlist."} Choose the type your provider gave you.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <ModeCard
              id={TAB_XTREAM_ID}
              icon={Radio}
              title="Xtream Codes"
              description="Server URL, username and password"
              selected={mode === "xtream"}
              onClick={() => chooseMode("xtream")}
            />
            <ModeCard
              id={TAB_M3U_ID}
              icon={Rss}
              title="M3U Playlist"
              description="A single playlist link (.m3u / .m3u8)"
              selected={mode === "m3u-url"}
              onClick={() => chooseMode("m3u-url")}
            />
          </div>
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
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {field(FIELD_NAME_ID, "Playlist name", name, setName)}
            {mode === "xtream" ? (
              <>
                {field(FIELD_URL_ID, "Server URL", baseUrl, setBaseUrl, { placeholder: "http://host:port" })}
                {field(FIELD_USERNAME_ID, "Username", username, setUsername)}
                {field(FIELD_PASSWORD_ID, "Password", password, setPassword, { type: "password" })}
              </>
            ) : (
              field(FIELD_M3U_URL_ID, "Playlist URL", m3uUrl, setM3uUrl, { placeholder: "https://example.com/playlist.m3u8" })
            )}
          </div>

          <p role="alert" style={{ minHeight: "1.75rem", margin: "1.5rem 0 1.25rem", fontSize: TV_TEXT, fontWeight: 600, color: "#ff8a8a" }}>
            {error}
          </p>

          <div style={{ display: "flex", gap: "1.25rem" }}>
            <TvButton
              id={SUBMIT_ID}
              label={isValidating ? "Connecting…" : "Save & Continue"}
              icon={isValidating ? LoaderCircle : Check}
              variant="primary"
              busy={isValidating}
              onSelect={handleSubmit}
            />
            {canSaveAnyway && !isValidating && <TvButton id={SAVE_ANYWAY_ID} label="Save anyway" onSelect={handleSaveAnyway} />}
            {onCancel && <TvButton id={CANCEL_ID} label="Cancel" onSelect={onCancel} disabled={isValidating} />}
          </div>
        </section>
      </div>
    </MeshBackground>
  );
}

function ModeCard({
  id,
  icon: Icon,
  title,
  description,
  selected,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  const isFocused = useIsFocused(id);
  return (
    <Focusable id={id} style={{ height: "auto" }}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onClick}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "1.25rem",
          padding: "1.375rem 1.5rem",
          border: "none",
          borderRadius: "1.25rem",
          textAlign: "left",
          background: isFocused ? "#ffffff" : selected ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
          color: isFocused ? "#0b0c10" : "#fff",
          boxShadow: isFocused
            ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)"
            : selected
              ? "inset 0 0 0 2px var(--accent)"
              : "inset 0 0 0 1px rgba(255,255,255,0.08)",
          transform: isFocused ? "scale(1.03)" : "scale(1)",
          transition: "transform 200ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        <Icon size="2.25rem" strokeWidth={1.75} color={isFocused ? "#0b0c10" : "var(--accent)"} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: "1.625rem", fontWeight: 700 }}>{title}</span>
          <span style={{ display: "block", fontSize: "1.125rem", marginTop: "0.25rem", color: isFocused ? "#3a3d45" : "var(--text-dim)" }}>
            {description}
          </span>
        </span>
        {selected && <Check size="1.75rem" strokeWidth={2.5} color={isFocused ? "#0b0c10" : "var(--accent)"} style={{ flexShrink: 0 }} />}
      </button>
    </Focusable>
  );
}
