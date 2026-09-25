import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { resolveDigitKey, type PlatformId } from "@core";
import { Delete, Lock } from "lucide-react";
import { buildGridFocusGraph, Focusable, MeshBackground, TV_TEXT, useFocusStore, useIsFocused, useRemoteInput } from "@ui";
import { PIN_LENGTH } from "../parental-store.js";

const SCOPE = "pin-pad";
const keyId = (key: string) => `pin-key:${key}`;
/** 3×4 keypad, row-major: 1–9, then Clear, 0, Back. */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;
const SHAKE_MS = 450;

export type PinPadResult = { ok: true } | { ok: false; message: string; lockedForMs?: number };

export interface PinPadProps {
  platform: PlatformId;
  title: string;
  subtitle?: string;
  /** Called with each complete PIN; resolve ok to finish, or an error to shake, clear and let the user retry. */
  onComplete: (pin: string) => Promise<PinPadResult>;
  /** The remote's Back key (and the keypad's Back on an empty PIN). */
  onCancel: () => void;
  /** Already locked out when opened (see parental-store's getLockoutRemainingMs). */
  initialLockedForMs?: number;
  /** Extra content under the keypad (e.g. the forgot-PIN note). */
  footer?: ReactNode;
}

/**
 * The parent PIN keypad (docs/kids-profile.md §2.4), full screen and TV
 * remote first: a 3×4 grid on the focus graph plus the remote's own number
 * keys. Digits show masked as they're entered and the PIN submits on the
 * 4th. A wrong PIN shakes the dots red and clears them, focus staying on
 * the keypad; a lockout shows a countdown and ignores input until it ends.
 *
 * Owns the remote input while shown — callers render it *instead of* their
 * own screen (never nested inside one that also calls useRemoteInput).
 */
export function PinPad({ platform, title, subtitle, onComplete, onCancel, initialLockedForMs = 0, footer }: PinPadProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(() => (initialLockedForMs > 0 ? Date.now() + initialLockedForMs : 0));
  const [now, setNow] = useState(() => Date.now());
  const isCheckingRef = useRef(false);
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  const lockedUntilRef = useRef(lockedUntil);
  lockedUntilRef.current = lockedUntil;
  const callbacksRef = useRef({ onComplete, onCancel });
  callbacksRef.current = { onComplete, onCancel };

  const lockedSeconds = lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const submit = useCallback((pin: string) => {
    isCheckingRef.current = true;
    void callbacksRef.current
      .onComplete(pin)
      .then((result) => {
        if (result.ok) return;
        setError(result.message);
        setDigits("");
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), SHAKE_MS);
        if (result.lockedForMs && result.lockedForMs > 0) {
          setLockedUntil(Date.now() + result.lockedForMs);
          setNow(Date.now());
        }
      })
      .finally(() => {
        isCheckingRef.current = false;
      });
  }, []);

  const press = useCallback(
    (key: (typeof KEYS)[number]) => {
      if (isCheckingRef.current || lockedUntilRef.current > Date.now()) return;
      const current = digitsRef.current;
      if (key === "clear") {
        setDigits("");
        return;
      }
      if (key === "back") {
        if (current.length === 0) callbacksRef.current.onCancel();
        else setDigits(current.slice(0, -1));
        return;
      }
      if (current.length >= PIN_LENGTH) return;
      const next = current + key;
      setError(null);
      setDigits(next);
      digitsRef.current = next;
      if (next.length === PIN_LENGTH) submit(next);
    },
    [submit],
  );

  useEffect(() => {
    const ids = KEYS.map(keyId);
    const nodes = buildGridFocusGraph(ids, 3).map((node, index) => ({ ...node, onSelect: () => press(KEYS[index]) }));
    setGraph(SCOPE, nodes, keyId("5"));
  }, [press, setGraph]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  // The remote's number keys type straight into the PIN.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const digit = resolveDigitKey(event);
      if (digit === null || event.repeat) return;
      event.preventDefault();
      press(String(digit) as (typeof KEYS)[number]);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [press]);

  useRemoteInput(platform, { onBack: () => callbacksRef.current.onCancel() });

  const status = lockedSeconds > 0 ? `Too many wrong PINs. Try again in ${lockedSeconds} s` : error;

  return (
    <MeshBackground>
      <style>{`@keyframes pin-shake { 0%,100% { transform: translateX(0) } 20%,60% { transform: translateX(-0.75rem) } 40%,80% { transform: translateX(0.75rem) } }`}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.75rem", padding: "3rem" }}>
        <Lock size="3rem" strokeWidth={1.75} color="rgba(235,236,242,0.8)" aria-hidden />
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 800, color: "#fff", margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.75rem 0 0" }}>{subtitle}</p>}
        </div>

        <div
          role="status"
          aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}
          style={{ display: "flex", gap: "1.25rem", animation: isShaking ? `pin-shake ${SHAKE_MS}ms ease-in-out` : undefined }}
        >
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              style={{
                width: "1.5rem",
                height: "1.5rem",
                borderRadius: "50%",
                background: i < digits.length ? "#ffffff" : "transparent",
                boxShadow: `inset 0 0 0 0.1875rem ${isShaking ? "#ff6b6b" : "rgba(255,255,255,0.55)"}`,
                transition: "background 120ms ease-out",
              }}
            />
          ))}
        </div>

        <div style={{ minHeight: "2rem", fontSize: TV_TEXT, fontWeight: 600, color: "#ff8a8a" }} role="alert">
          {status}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 6.5rem)", gap: "1rem", opacity: lockedSeconds > 0 ? 0.4 : 1 }}>
          {KEYS.map((key) => (
            <PinKey key={key} keyName={key} onPress={() => press(key)} />
          ))}
        </div>
        {footer}
      </div>
    </MeshBackground>
  );
}

function PinKey({ keyName, onPress }: { keyName: (typeof KEYS)[number]; onPress: () => void }): JSX.Element {
  const id = keyId(keyName);
  const isFocused = useIsFocused(id);
  const label = keyName === "clear" ? "Clear" : keyName === "back" ? "Back" : keyName;
  return (
    <Focusable id={id} style={{ width: "6.5rem", height: "5rem" }}>
      <button
        type="button"
        aria-label={label}
        onClick={onPress}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "1rem",
          fontSize: /\d/.test(keyName) ? "2rem" : TV_TEXT,
          fontWeight: 700,
          background: isFocused ? "#ffffff" : "rgba(255,255,255,0.1)",
          color: isFocused ? "#0b0c10" : "#ffffff",
          boxShadow: isFocused ? "0 1rem 2rem -0.5rem rgba(0,0,0,0.6)" : "inset 0 0 0 1px rgba(255,255,255,0.08)",
          transform: isFocused ? "scale(1.08)" : "scale(1)",
          transition: "transform 160ms cubic-bezier(0.2, 0.9, 0.3, 1)",
          cursor: "pointer",
        }}
      >
        {keyName === "back" ? <Delete size="1.75rem" aria-hidden /> : label}
      </button>
    </Focusable>
  );
}
