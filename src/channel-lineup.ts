import type { Channel } from "@core";

/** The channels the player can move between: CH+/CH− walk `lineup`; number keys search `directory`. */
export interface ChannelLineup {
  /** What the viewer was browsing (a category, or My List), in order. */
  lineup: Channel[];
  /** Every live channel, for tuning by number. */
  directory: Channel[];
}

/**
 * Gives every channel a number: the provider's own, otherwise its position
 * in the full list — the numbers the Live TV list shows, so typing a number
 * in the player tunes to what the viewer saw.
 */
export function withChannelNumbers(channels: Channel[]): Channel[] {
  return channels.map((channel, index) => (channel.number !== undefined ? channel : { ...channel, number: index + 1 }));
}
