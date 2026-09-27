import { BROWSE_CONTENT_LEFT, BROWSE_SIDE_PADDING, TV_TEXT } from "@ui";
import type { StageState } from "../sync/sync-store.js";

export interface SyncNoticeProps {
  /** Plural noun for what's being built — "movies", "series". */
  what: string;
  /** The sync stage building it (sync-store.ts), or undefined before it has started. */
  state: StageState | undefined;
  /** Whether picking a single category works meanwhile (Xtream's server-side category fetch). */
  canPickCategory?: boolean;
}

/**
 * Stands in for the shelves while a source's movie/series table is still
 * being built by the sync manager — the screen never downloads the whole
 * catalog itself any more, so this is what a first visit shows instead:
 * that it's on its way, or why the sync failed (the scheduler retries it).
 */
export function SyncNotice({ what, state, canPickCategory = false }: SyncNoticeProps): JSX.Element {
  const failed = state?.status === "failed" || state?.status === "skipped";

  const headline = failed ? `Couldn't load your ${what}` : `Getting your ${what} ready…`;
  const detail = failed
    ? `${state?.error ?? "The provider didn't respond."} We'll try again automatically.`
    : canPickCategory
        ? "You can already open a category from the list on the left."
        : "This only takes a moment the first time.";

  return (
    <div role="status" style={{ padding: `2rem ${BROWSE_SIDE_PADDING} 0 ${BROWSE_CONTENT_LEFT}` }}>
      <p style={{ margin: 0, fontSize: "1.75rem", fontWeight: 700, color: failed ? "#ff8a8a" : "#fff" }}>{headline}</p>
      <p style={{ margin: "0.75rem 0 0", fontSize: TV_TEXT, color: "var(--text-dim)" }}>{detail}</p>
    </div>
  );
}
