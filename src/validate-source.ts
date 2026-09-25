import { XtreamAuthError, XtreamClient, type PlaylistSource } from "@core";
import { isTimeoutError, proxyFetch } from "./proxy-fetch.js";

export type SourceValidationFailure = "auth" | "account" | "connections" | "timeout" | "unreachable" | "http" | "not-a-playlist";

export type SourceValidationResult =
  | { ok: true; expiresAt: Date | null }
  | {
      ok: false;
      reason: SourceValidationFailure;
      message: string;
      /** True only when the failure could be transient (no response, 5xx, every connection in use) — the credentials/URL might still be right, so the user may keep the source anyway. */
      canSaveAnyway: boolean;
    };

export interface ValidateSourceOptions {
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the app's timeout-guarded provider fetch. */
  fetchImpl?: typeof fetch;
}

const AUTH_FAILED_MESSAGE = "We couldn't sign in with these details. Check your username and password, and that the server URL is correct.";

/** How much of an M3U response to read before deciding whether it's a playlist — the header is on the first line, so a few KB is plenty and a 50MB playlist is never downloaded just to check it. */
const M3U_SNIFF_BYTES = 4096;

/**
 * Checks a new source actually works before AddSourceScreen saves it — the
 * provider accepts the login (Xtream) or the URL serves an M3U playlist —
 * so a typo'd password or server URL is caught on the form instead of
 * surfacing later as an unexplained error on some other screen.
 *
 * Never throws for provider problems; every failure comes back as a
 * user-facing message. An abort via `options.signal` does reject (with the
 * AbortError), since the caller cancelled and there's nothing to show.
 */
export async function validateSource(source: PlaylistSource, options: ValidateSourceOptions = {}): Promise<SourceValidationResult> {
  const baseFetch = options.fetchImpl ?? proxyFetch;
  const fetchImpl: typeof fetch = options.signal ? (input, init) => baseFetch(input, { ...init, signal: options.signal }) : baseFetch;

  try {
    if (source.kind === "xtream") return await validateXtream(source, fetchImpl);
    if (source.kind === "m3u-url") return await validateM3uUrl(source.url, fetchImpl);
    return { ok: true, expiresAt: null };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return classifyError(err, source.kind === "xtream");
  }
}

async function validateXtream(source: Extract<PlaylistSource, { kind: "xtream" }>, fetchImpl: typeof fetch): Promise<SourceValidationResult> {
  const { status, expiresAt, activeConnections, maxConnections } = await new XtreamClient(source, fetchImpl).getAccountInfo();
  const normalizedStatus = (status ?? "").trim().toLowerCase();

  // The login itself worked (auth: 1) — these are accounts the provider has switched off. The explicit status wins over the expiry date.
  if (normalizedStatus === "banned") {
    return { ok: false, reason: "account", message: "This account has been banned by your provider. Contact them for help.", canSaveAnyway: false };
  }
  if (normalizedStatus === "disabled") {
    return { ok: false, reason: "account", message: "This account is disabled. Contact your provider to turn it back on.", canSaveAnyway: false };
  }
  if (normalizedStatus === "expired" || (expiresAt !== null && expiresAt.getTime() < Date.now())) {
    const when = expiresAt ? ` on ${expiresAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}` : "";
    return { ok: false, reason: "account", message: `This account expired${when}. Contact your provider to renew it.`, canSaveAnyway: false };
  }

  // Valid account, but every stream slot is taken by other devices — playback would fail right now, though the details are fine and a slot frees up once another device stops.
  if (maxConnections !== null && activeConnections !== null && activeConnections >= maxConnections) {
    const slots = maxConnections === 1 ? "The only connection" : `All ${maxConnections} connections`;
    return {
      ok: false,
      reason: "connections",
      message: `${slots} on this account ${maxConnections === 1 ? "is" : "are"} in use. Stop watching on another device and try again.`,
      canSaveAnyway: true,
    };
  }
  return { ok: true, expiresAt };
}

async function validateM3uUrl(url: string, fetchImpl: typeof fetch): Promise<SourceValidationResult> {
  const response = await fetchImpl(url);
  if (!response.ok) return httpFailure(response.status, false);

  const head = (await readHead(response)).replace(/^﻿/, "").trimStart();
  if (head.startsWith("#EXTM3U") || head.includes("#EXTINF")) return { ok: true, expiresAt: null };
  return { ok: false, reason: "not-a-playlist", message: "That link doesn't return an M3U playlist. Check the playlist URL.", canSaveAnyway: false };
}

/** First few KB of the body, streamed where possible so a huge playlist isn't downloaded in full just to read its header. */
async function readHead(response: Response): Promise<string> {
  const body = response.body;
  if (body && typeof body.getReader === "function" && typeof TextDecoder !== "undefined") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    try {
      while (text.length < M3U_SNIFF_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return text;
  }
  return (await response.text()).slice(0, M3U_SNIFF_BYTES);
}

function httpFailure(status: number, isXtream: boolean): SourceValidationResult {
  const target = isXtream ? "server URL" : "playlist URL";
  if (status >= 500) {
    return { ok: false, reason: "http", message: `The server had a problem (HTTP ${status}). Try again in a moment.`, canSaveAnyway: true };
  }
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth", message: isXtream ? AUTH_FAILED_MESSAGE : "The playlist server refused access. Check the playlist URL.", canSaveAnyway: false };
  }
  return { ok: false, reason: "http", message: `The server answered with an error (HTTP ${status}). Check the ${target}.`, canSaveAnyway: false };
}

function classifyError(err: unknown, isXtream: boolean): SourceValidationResult {
  if (err instanceof XtreamAuthError) {
    return { ok: false, reason: "auth", message: AUTH_FAILED_MESSAGE, canSaveAnyway: false };
  }
  // A stalled body stream (readHead) aborts with a bare AbortError rather than going through proxyFetch's wrapped readers — the only thing aborting it here is the timeout.
  if (isTimeoutError(err) || (err instanceof Error && err.name === "AbortError")) {
    return { ok: false, reason: "timeout", message: "The server didn't respond. Check the URL, or try again.", canSaveAnyway: true };
  }
  const httpStatus = err instanceof Error ? /HTTP (\d{3})/.exec(err.message)?.[1] : undefined;
  if (httpStatus) return httpFailure(Number(httpStatus), isXtream);
  // Bad JSON from player_api.php: something answered, but not an Xtream panel.
  if (err instanceof SyntaxError) {
    return { ok: false, reason: "http", message: "That doesn't look like an Xtream Codes server. Check the server URL.", canSaveAnyway: false };
  }
  return { ok: false, reason: "unreachable", message: "Couldn't reach the server. Check the URL and your TV's internet connection.", canSaveAnyway: true };
}
