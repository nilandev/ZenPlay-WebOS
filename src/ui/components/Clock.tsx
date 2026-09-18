import { useEffect, useState } from "react";

/** Centered wall-clock readout (time + date), ticking once a minute — plenty for a TV display. */
export function Clock(): JSX.Element {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{ textAlign: "center", lineHeight: 1.3 }}>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{time}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-dim)", whiteSpace: "nowrap", marginTop: "0.25rem" }}>{date}</div>
    </div>
  );
}
