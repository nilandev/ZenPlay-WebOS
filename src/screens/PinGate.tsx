import { useState } from "react";
import { verifyPin } from "@core";

export interface PinGateProps {
  pinHash: string;
  title?: string;
  onUnlock: () => void;
  onCancel: () => void;
}

/**
 * Blocking PIN entry overlay for parental-controlled categories/profiles.
 * Numeric-only input so it works with a remote's number pad as well as an
 * on-screen keyboard.
 */
export function PinGate({ pinHash, title = "Enter PIN", onUnlock, onCancel }: PinGateProps): JSX.Element {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const isValid = await verifyPin(pin, pinHash);
    if (isValid) {
      onUnlock();
    } else {
      setError(true);
      setPin("");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
        <h2>{title}</h2>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            setError(false);
          }}
          style={{ fontSize: 24, textAlign: "center", width: 160, letterSpacing: 8 }}
        />
        {error && <span style={{ color: "#ff6b6b" }}>Incorrect PIN</span>}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit">Unlock</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
