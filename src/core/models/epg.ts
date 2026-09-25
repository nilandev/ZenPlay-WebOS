export interface EpgProgramme {
  channelId: string;
  title: string;
  description?: string;
  /** XMLTV <category> values, when the guide has them — the Kids real-time check reads these. */
  categories?: string[];
  /** XMLTV <rating><value>, e.g. "TV-MA" or "18". */
  rating?: string;
  start: Date;
  stop: Date;
}

export interface EpgChannelGuide {
  channelId: string;
  programmes: EpgProgramme[];
}
