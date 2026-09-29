import type { PlayerEngine } from "@player";

/**
 * A playing stream detached from the VideoSurface that started it, waiting
 * for the next VideoSurface on the same URL to adopt it — so Live TV's
 * preview can go full screen, and come back from it, without reloading the
 * channel. While it waits, the <video> sits in a hidden holder on <body>:
 * the surface it came from may be about to unmount (the fullscreen player
 * closing), and a media element left out of the document gets paused.
 * Every move is a single appendChild, so it's never out of the document.
 */
export interface ParkedVideo {
  streamUrl: string;
  engine: PlayerEngine;
  video: HTMLVideoElement;
}

/** Gives up its player if it's playing `streamUrl` right now, or returns null. */
type VideoDonor = (streamUrl: string) => ParkedVideo | null;

/** A parked stream nobody adopts in this time is torn down, so it can't keep decoding unseen. */
const UNCLAIMED_DISCARD_MS = 5000;

const donors = new Set<VideoDonor>();
let parked: ParkedVideo | null = null;
let discardTimer: ReturnType<typeof setTimeout> | null = null;

/** Registers a VideoSurface that may hand its stream on; returns the unregister function. */
export function registerVideoDonor(donor: VideoDonor): () => void {
  donors.add(donor);
  return () => donors.delete(donor);
}

/**
 * Detaches the stream playing `streamUrl` from whichever surface has it, to
 * be adopted by the next VideoSurface that loads that URL. Call it just
 * before opening that surface. Returns false when nothing is playing it
 * (still loading, another channel), and the new surface loads it normally.
 */
export function handOffVideo(streamUrl: string): boolean {
  for (const donor of donors) {
    const video = donor(streamUrl);
    if (!video) continue;
    discardParkedVideo();
    holder().appendChild(video.video);
    parked = video;
    discardTimer = setTimeout(discardParkedVideo, UNCLAIMED_DISCARD_MS);
    return true;
  }
  return false;
}

/** True when a stream on `streamUrl` is waiting to be adopted — lets the adopter skip its loading screen from the first render. */
export function hasParkedVideo(streamUrl: string): boolean {
  return parked?.streamUrl === streamUrl;
}

/**
 * Takes the parked stream if it's playing `streamUrl`. The next surface to
 * load decides: a different URL (the player changed channel before closing)
 * means nobody will want the parked one, so it's torn down now rather than
 * decoding unseen alongside the new stream.
 */
export function takeParkedVideo(streamUrl: string): ParkedVideo | null {
  if (!parked) return null;
  if (parked.streamUrl !== streamUrl) {
    discardParkedVideo();
    return null;
  }
  const video = parked;
  parked = null;
  if (discardTimer) clearTimeout(discardTimer);
  discardTimer = null;
  return video;
}

function discardParkedVideo(): void {
  if (discardTimer) clearTimeout(discardTimer);
  discardTimer = null;
  if (!parked) return;
  parked.engine.destroy();
  parked.video.remove();
  parked = null;
}

let holderElement: HTMLDivElement | null = null;

/** Out of sight but in the document — it only ever holds a video for the moment between two surfaces. */
function holder(): HTMLDivElement {
  if (holderElement?.isConnected) return holderElement;
  holderElement = document.createElement("div");
  holderElement.setAttribute("aria-hidden", "true");
  Object.assign(holderElement.style, { position: "fixed", width: "0", height: "0", overflow: "hidden", pointerEvents: "none" });
  document.body.appendChild(holderElement);
  return holderElement;
}
