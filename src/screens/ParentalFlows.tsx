import { useEffect, useRef, useState } from "react";
import type { PlatformId } from "@core";
import { KeyRound, ShieldCheck } from "lucide-react";
import { BROWSE_SIDE_PADDING, MeshBackground, TV_TEXT, TvButton, useFocusStore, useRemoteInput } from "@ui";
import { acknowledgeDisclaimer, checkPin, getLockoutRemainingMs, requiresPin, setPin } from "../parental-store.js";
import { ParentalDisclaimer } from "./ParentalDisclaimer.js";
import { PinPad, type PinPadResult } from "./PinPad.js";

/** Shown under every PIN entry: there's no server, so a forgotten PIN can only be reset by clearing the app's data. */
function ForgotPinNote(): JSX.Element {
  return (
    <p style={{ maxWidth: "46rem", textAlign: "center", fontSize: "1.125rem", color: "var(--text-dim)", margin: 0 }}>
      Forgot the PIN? Clear this app's data in your TV's app settings to reset it — this also removes profiles and playlists.
    </p>
  );
}

/** Checks a PIN attempt against the stored one, in PinPad's result shape. */
export async function verifyParentPin(pin: string): Promise<PinPadResult> {
  const result = await checkPin(pin);
  if (result.ok) return { ok: true };
  if (result.lockedForMs > 0) return { ok: false, message: "", lockedForMs: result.lockedForMs };
  return { ok: false, message: `Wrong PIN · ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left` };
}

export interface PinGateProps {
  platform: PlatformId;
  title: string;
  subtitle?: string;
  onUnlock: () => void;
  onCancel: () => void;
}

/**
 * Guards a parent-only action (docs/kids-profile.md §2.3). In locked mode
 * it asks for the PIN; in trust mode (no PIN set) it never shows the
 * keypad and unlocks straight away.
 */
export function PinGate({ platform, title, subtitle, onUnlock, onCancel }: PinGateProps): JSX.Element {
  const [needsPin] = useState(() => requiresPin());
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  useEffect(() => {
    if (!needsPin) onUnlockRef.current();
  }, [needsPin]);

  if (!needsPin) return <MeshBackground>{null}</MeshBackground>;
  return (
    <PinPad
      platform={platform}
      title={title}
      subtitle={subtitle ?? "Enter the parent PIN"}
      initialLockedForMs={getLockoutRemainingMs()}
      onComplete={async (pin) => {
        const result = await verifyParentPin(pin);
        if (result.ok) onUnlockRef.current();
        return result;
      }}
      onCancel={onCancel}
      footer={<ForgotPinNote />}
    />
  );
}

/** Choose a new 4-digit PIN, entered twice; saves it (trust → locked, or a new PIN) and calls onDone. */
export function PinSetupFlow({ platform, onDone, onCancel }: { platform: PlatformId; onDone: () => void; onCancel: () => void }): JSX.Element {
  const [first, setFirst] = useState<string | null>(null);

  if (first === null) {
    return (
      <PinPad
        key="choose"
        platform={platform}
        title="Choose a parent PIN"
        subtitle="4 digits. You'll need it to leave a Kids profile and to change what kids can watch."
        onComplete={async (pin) => {
          setFirst(pin);
          return { ok: true };
        }}
        onCancel={onCancel}
        footer={<ForgotPinNote />}
      />
    );
  }
  return (
    <PinPad
      key="confirm"
      platform={platform}
      title="Enter the PIN again"
      subtitle="To make sure it's right."
      onComplete={async (pin) => {
        if (pin !== first) {
          setFirst(null);
          return { ok: false, message: "The PINs didn't match — choose one again." };
        }
        await setPin(pin);
        onDone();
        return { ok: true };
      }}
      onCancel={() => setFirst(null)}
    />
  );
}

const CONFIRM_SCOPE = "kids-confirm";
const SET_PIN_ID = "kids-confirm-set-pin";
const NOT_NOW_ID = "kids-confirm-not-now";

/**
 * Shown once, after the first Kids profile is saved (docs/kids-profile.md
 * §2.2 and §5.2 #1): the Parental Discretion Disclaimer, then "Protect
 * parent settings with a PIN?". Either answer counts as the parent's
 * acknowledgement of the disclaimer; Not now leaves the household in trust
 * mode, and the step isn't offered again automatically.
 */
export function FirstKidsProfileSetup({ platform, onFinished }: { platform: PlatformId; onFinished: () => void }): JSX.Element {
  const [isSettingPin, setIsSettingPin] = useState(false);

  if (isSettingPin) {
    return <PinSetupFlow platform={platform} onDone={onFinished} onCancel={() => setIsSettingPin(false)} />;
  }
  return (
    <KidsConfirmStep
      platform={platform}
      onSetPin={() => {
        acknowledgeDisclaimer();
        setIsSettingPin(true);
      }}
      onNotNow={() => {
        acknowledgeDisclaimer();
        onFinished();
      }}
    />
  );
}

function KidsConfirmStep({ platform, onSetPin, onNotNow }: { platform: PlatformId; onSetPin: () => void; onNotNow: () => void }): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const callbacksRef = useRef({ onSetPin, onNotNow });
  callbacksRef.current = { onSetPin, onNotNow };

  useEffect(() => {
    setGraph(
      CONFIRM_SCOPE,
      [
        { id: SET_PIN_ID, neighbors: { right: NOT_NOW_ID }, onSelect: () => callbacksRef.current.onSetPin() },
        { id: NOT_NOW_ID, neighbors: { left: SET_PIN_ID }, onSelect: () => callbacksRef.current.onNotNow() },
      ],
      SET_PIN_ID,
    );
    useFocusStore.getState().focus(SET_PIN_ID);
    return () => clearGraph(CONFIRM_SCOPE);
  }, [setGraph, clearGraph]);

  // Back counts as "Not now" — the disclaimer has been shown either way.
  useRemoteInput(platform, { onBack: () => callbacksRef.current.onNotNow() });

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: `3rem ${BROWSE_SIDE_PADDING}` }}>
        <div
          style={{
            maxWidth: "64rem",
            display: "flex",
            flexDirection: "column",
            gap: "2rem",
            padding: "3rem 3.5rem",
            borderRadius: "1.75rem",
            background: "rgba(16,17,23,0.92)",
            boxShadow: "0 2rem 4rem rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <ShieldCheck size="2.5rem" color="var(--accent)" aria-hidden />
            <h1 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#fff", margin: 0 }}>Kids profile ready</h1>
          </div>
          <ParentalDisclaimer />
          <div>
            <h2 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#fff", margin: "0 0 0.5rem" }}>Protect parent settings with a PIN?</h2>
            <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: 0 }}>Without a PIN, a child can switch to a parent profile and see everything.</p>
          </div>
          <div style={{ display: "flex", gap: "1.25rem" }}>
            <TvButton id={SET_PIN_ID} label="Set PIN" icon={KeyRound} variant="primary" onSelect={onSetPin} />
            <TvButton id={NOT_NOW_ID} label="Not now" onSelect={onNotNow} />
          </div>
        </div>
      </div>
    </MeshBackground>
  );
}
