export interface EpgProgramme {
  channelId: string;
  title: string;
  description?: string;
  start: Date;
  stop: Date;
}

export interface EpgChannelGuide {
  channelId: string;
  programmes: EpgProgramme[];
}
