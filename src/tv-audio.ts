/**
 * The TV's own mute state. On most LG TVs the remote's Mute key never
 * reaches the app — the TV mutes itself — so the player can only show
 * "Muted" by asking the system. webOS exposes that through the audio luna
 * service; the app doesn't load webOSTV.js, so this talks to the runtime's
 * PalmServiceBridge directly.
 *
 * Best-effort: outside webOS (no bridge), or on firmware that refuses the
 * call, the callback simply never fires.
 */

interface PalmServiceBridgeLike {
  onservicecallback: ((message: string) => void) | null;
  call(uri: string, params: string): void;
  cancel(): void;
}

type PalmServiceBridgeConstructor = new () => PalmServiceBridgeLike;

/**
 * Where the volume lives differs between firmware: webOS TV's audio service
 * is com.webos.audio, with the master volume under the "master" category
 * like webOS OSE's com.webos.service.audio
 * (https://www.webosose.org/docs/reference/ls2-api/com-webos-service-audio/#mastergetvolume);
 * older TVs had getVolume at the top level. A TV without one answers
 * "Unknown method" / "service does not exist", so each is tried in turn
 * until one answers.
 */
const GET_VOLUME_URIS = [
  "luna://com.webos.audio/master/getVolume",
  "luna://com.webos.service.audio/master/getVolume",
  "luna://com.webos.audio/getVolume",
];

/** Reads the mute flag from any of the response shapes: master/getVolume nests it in volumeStatus (as muted, or muteStatus on some firmware); older firmware has it at the top level. */
export function parseMuteStatus(message: string): boolean | null {
  try {
    const response = JSON.parse(message) as {
      returnValue?: boolean;
      muted?: unknown;
      muteStatus?: unknown;
      volumeStatus?: { muted?: unknown; muteStatus?: unknown };
    };
    if (response.returnValue === false) return null;
    if (typeof response.volumeStatus?.muted === "boolean") return response.volumeStatus.muted;
    if (typeof response.volumeStatus?.muteStatus === "boolean") return response.volumeStatus.muteStatus;
    if (typeof response.muteStatus === "boolean") return response.muteStatus;
    if (typeof response.muted === "boolean") return response.muted;
  } catch {
    // Not JSON — ignore it.
  }
  return null;
}

function isFailure(message: string): boolean {
  try {
    return (JSON.parse(message) as { returnValue?: boolean }).returnValue === false;
  } catch {
    return false;
  }
}

/** Calls onChange with the TV's mute state now and whenever it changes. Returns an unsubscribe. */
export function subscribeTvMute(onChange: (muted: boolean) => void): () => void {
  const MaybeBridge = (globalThis as { PalmServiceBridge?: PalmServiceBridgeConstructor }).PalmServiceBridge;
  if (typeof MaybeBridge !== "function") return () => {};
  const Bridge: PalmServiceBridgeConstructor = MaybeBridge;
  let bridge: PalmServiceBridgeLike | null = null;
  let isCancelled = false;

  function close(): void {
    if (!bridge) return;
    try {
      bridge.onservicecallback = null;
      bridge.cancel();
    } catch {
      // Already gone.
    }
    bridge = null;
  }

  function subscribe(uriIndex: number): void {
    const uri = GET_VOLUME_URIS[uriIndex];
    if (!uri || isCancelled) return;
    try {
      const current = new Bridge();
      bridge = current;
      current.onservicecallback = (message) => {
        if (isFailure(message)) {
          // This firmware doesn't have it here — try the next place (off the callback, which the bridge is still in).
          close();
          setTimeout(() => subscribe(uriIndex + 1), 0);
          return;
        }
        const muted = parseMuteStatus(message);
        if (muted !== null) onChange(muted);
      };
      current.call(uri, JSON.stringify({ subscribe: true }));
    } catch {
      close();
      subscribe(uriIndex + 1);
    }
  }

  subscribe(0);
  return () => {
    isCancelled = true;
    close();
  };
}
