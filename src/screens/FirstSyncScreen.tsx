import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PlatformId, PlaylistSource } from "@core";
import { AlertCircle, ArrowRight, Check, RotateCcw } from "lucide-react";
import { BROWSE_SIDE_PADDING, MeshBackground, TV_TEXT, TvButton, useFocusStore, useRemoteInput, type FocusNode } from "@ui";
import { epgUrlFor } from "../epg-sync.js";
import { syncSource } from "../sync/sync-manager.js";
import { useSourceSyncState, type ContentStage, type StageState } from "../sync/sync-store.js";
import { stageLabel } from "../sync/sync-summary.js";

const SCOPE = "first-sync";
const CONTINUE_ID = "first-sync-continue";
const RETRY_ID = "first-sync-retry";
const CONTINUE_ANYWAY_ID = "first-sync-continue-anyway";
/** Once everything has downloaded, how long the finished state stays up before moving on by itself. */
const AUTO_CONTINUE_MS = 1200;

const DONE: ReadonlySet<StageState["status"] | undefined> = new Set(["synced", "fresh", "not-applicable"]);
const isDone = (state: StageState | undefined) => DONE.has(state?.status);
const isFailed = (state: StageState | undefined) => state?.status === "failed" || (state?.status === "skipped" && state.error !== undefined);

/** The stages this source actually has — M3U movies come with its live stage, and it has no series. */
function stagesFor(source: PlaylistSource): ContentStage[] {
  const stages: ContentStage[] = source.kind === "xtream" ? ["live", "vod", "series"] : ["live"];
  if (epgUrlFor(source)) stages.push("epg");
  return stages;
}

export interface FirstSyncScreenProps {
  source: PlaylistSource;
  platform: PlatformId;
  /** Leave for the app — the rest keeps syncing in the background (screens show their own progress). */
  onContinue: () => void;
}

/**
 * Shown the first time a playlist is used (just added, or never
 * downloaded): one row per part of the playlist with its live progress, like
 * the "Downloading Live / Movies / Series" step in other IPTV apps.
 *
 * Continue unlocks as soon as live channels are in, so TV is watchable
 * while movies, series and the guide keep downloading in the background.
 * A failed part shows why, with Retry and Continue anyway; Back always
 * continues. When everything finishes cleanly the screen moves on by itself.
 */
export function FirstSyncScreen({ source, platform, onContinue }: FirstSyncScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);
  const syncState = useSourceSyncState(source.id);
  const stages = useMemo(() => stagesFor(source), [source]);

  useEffect(() => {
    void syncSource(source, { trigger: "first-run" });
  }, [source]);

  const liveReady = isDone(syncState.stages.live);
  const failedStages = stages.filter((stage) => isFailed(syncState.stages[stage]));
  const hasFailures = !syncState.isRunning && (failedStages.length > 0 || isFailed(syncState.stages.auth));
  const allDone = !syncState.isRunning && stages.every((stage) => isDone(syncState.stages[stage]));

  const retry = useCallback(() => {
    const toRetry = failedStages.length > 0 ? failedStages : stages;
    void syncSource(source, { trigger: "manual", stages: toRetry, force: true });
  }, [source, stages, failedStages]);

  // Finished with nothing wrong: move on without making the user press anything.
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;
  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(() => onContinueRef.current(), AUTO_CONTINUE_MS);
    return () => clearTimeout(timer);
  }, [allDone]);

  const buttonIds = [...(liveReady ? [CONTINUE_ID] : []), ...(hasFailures ? [RETRY_ID, ...(liveReady ? [] : [CONTINUE_ANYWAY_ID])] : [])];
  const buttonIdsKey = buttonIds.join("|");
  const actions = useRef({ onContinue, retry });
  actions.current = { onContinue, retry };
  useEffect(() => {
    const ids = buttonIdsKey ? buttonIdsKey.split("|") : [];
    const onSelect: Record<string, () => void> = {
      [CONTINUE_ID]: () => actions.current.onContinue(),
      [RETRY_ID]: () => actions.current.retry(),
      [CONTINUE_ANYWAY_ID]: () => actions.current.onContinue(),
    };
    const nodes: FocusNode[] = ids.map((id, index) => ({ id, neighbors: { left: ids[index - 1], right: ids[index + 1] }, onSelect: onSelect[id] }));
    setGraph(SCOPE, nodes, ids[0]);
    if (ids[0] && !ids.includes(useFocusStore.getState().focusedId ?? "")) useFocusStore.getState().focus(ids[0]);
  }, [buttonIdsKey, setGraph]);
  useEffect(() => () => clearGraph(SCOPE), [clearGraph]);

  useRemoteInput(platform, { onBack: onContinue });

  const signInError = isFailed(syncState.stages.auth) ? syncState.stages.auth?.error : undefined;

  return (
    <MeshBackground>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: `3rem ${BROWSE_SIDE_PADDING}`, boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: "60rem" }}>
          <h1 style={{ fontSize: "3rem", fontWeight: 800, color: "#fff", margin: 0 }}>
            {allDone ? "All set" : `Setting up ${source.name}`}
          </h1>
          <p style={{ fontSize: TV_TEXT, color: "var(--text-dim)", margin: "0.75rem 0 2.5rem", lineHeight: 1.5 }}>
            {signInError
              ? `Couldn't sign in: ${signInError}`
              : liveReady
                ? "Live TV is ready. The rest keeps downloading in the background."
                : "Downloading your playlist. This only happens once — after that it updates in the background."}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginBottom: "2.5rem" }}>
            {stages.map((stage) => (
              <StageRow key={stage} label={stageLabel(stage, source)} state={syncState.stages[stage]} />
            ))}
          </div>

          <div style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
            {liveReady && <TvButton id={CONTINUE_ID} label="Continue" icon={ArrowRight} variant="primary" onSelect={onContinue} />}
            {hasFailures && <TvButton id={RETRY_ID} label="Retry" icon={RotateCcw} onSelect={retry} />}
            {hasFailures && !liveReady && <TvButton id={CONTINUE_ANYWAY_ID} label="Continue anyway" onSelect={onContinue} />}
            {!liveReady && !hasFailures && <span style={{ fontSize: "1.125rem", color: "var(--text-dim)" }}>Press Back to continue while this finishes.</span>}
          </div>
        </div>
      </div>
      <style>{`@keyframes first-sync-indeterminate { from { transform: translateX(-100%); } to { transform: translateX(250%); } }`}</style>
    </MeshBackground>
  );
}

function StageRow({ label, state }: { label: string; state: StageState | undefined }): JSX.Element {
  const status = state?.status;
  const failed = isFailed(state);
  const done = isDone(state);
  const running = status === "running";

  const detail = failed
    ? (state?.error ?? "Failed")
    : status === "synced"
      ? `${state?.count !== undefined ? state.count.toLocaleString() : "Done"}`
      : status === "fresh"
        ? "Up to date"
        : running
          ? state?.done
            ? `${state.done.toLocaleString()} so far`
            : "Downloading…"
          : "Waiting";

  return (
    <div role="group" aria-label={label}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.625rem", fontSize: "1.5rem", fontWeight: 700, color: "#fff" }}>
          {done && <Check size="1.5rem" color="#4ade80" strokeWidth={3} />}
          {failed && <AlertCircle size="1.5rem" color="#ff8a8a" />}
          {label}
        </span>
        <span style={{ fontSize: "1.25rem", color: failed ? "#ff8a8a" : "var(--text-dim)", textAlign: "right" }}>{detail}</span>
      </div>
      <div style={{ position: "relative", height: "0.375rem", borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
        {running ? (
          // No total is known up front (a provider's list size only comes with the list), so running is indeterminate.
          <div style={{ position: "absolute", inset: 0, width: "40%", borderRadius: 999, background: "var(--accent)", animation: "first-sync-indeterminate 1.4s ease-in-out infinite" }} />
        ) : (
          <div style={{ height: "100%", width: done || failed ? "100%" : "0%", background: failed ? "#ff8a8a" : "#4ade80", transition: "width 300ms ease-out" }} />
        )}
      </div>
    </div>
  );
}
