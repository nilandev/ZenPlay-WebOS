import { useEffect, useState } from "react";

/** Top-right date/time readout, ticking once a minute — plenty for a wall-clock display. */
export function Clock(): JSX.Element {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{ textAlign: "right", lineHeight: 1.3 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{time}</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{date}</div>
    </div>
  );
}
