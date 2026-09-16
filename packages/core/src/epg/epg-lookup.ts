import type { EpgProgramme } from "../models/epg.js";

export interface NowNext {
  now?: EpgProgramme;
  next?: EpgProgramme;
}

/**
 * Programmes for a single channel, kept sorted by start time so now/next
 * lookups and the EPG grid can binary-search instead of rescanning.
 */
export class ChannelGuide {
  private readonly sorted: EpgProgramme[];

  constructor(programmes: EpgProgramme[]) {
    this.sorted = [...programmes].sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  getProgrammes(): readonly EpgProgramme[] {
    return this.sorted;
  }

  getNowNext(at: Date = new Date()): NowNext {
    const atMs = at.getTime();
    let now: EpgProgramme | undefined;
    let next: EpgProgramme | undefined;

    for (const programme of this.sorted) {
      if (programme.start.getTime() <= atMs && atMs < programme.stop.getTime()) {
        now = programme;
        continue;
      }
      if (programme.start.getTime() > atMs) {
        next = programme;
        break;
      }
    }
    return { now, next };
  }

  /** Programmes overlapping [rangeStart, rangeEnd) — used to render the EPG timeline grid. */
  getProgrammesInRange(rangeStart: Date, rangeEnd: Date): EpgProgramme[] {
    return this.sorted.filter((p) => p.start < rangeEnd && p.stop > rangeStart);
  }
}

/** Groups a flat programme list into one ChannelGuide per channelId. */
export function buildChannelGuides(programmes: EpgProgramme[]): Map<string, ChannelGuide> {
  const byChannel = new Map<string, EpgProgramme[]>();
  for (const programme of programmes) {
    const list = byChannel.get(programme.channelId);
    if (list) {
      list.push(programme);
    } else {
      byChannel.set(programme.channelId, [programme]);
    }
  }

  const guides = new Map<string, ChannelGuide>();
  for (const [channelId, list] of byChannel) {
    guides.set(channelId, new ChannelGuide(list));
  }
  return guides;
}
