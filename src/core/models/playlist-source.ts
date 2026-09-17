export type PlaylistSourceKind = "xtream" | "m3u-url" | "m3u-file";

export interface XtreamCredentials {
  kind: "xtream";
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}

export interface M3uUrlSource {
  kind: "m3u-url";
  id: string;
  name: string;
  url: string;
  epgUrl?: string;
}

export interface M3uFileSource {
  kind: "m3u-file";
  id: string;
  name: string;
  /** Raw M3U text persisted locally after import. */
  content: string;
  epgUrl?: string;
}

export type PlaylistSource = XtreamCredentials | M3uUrlSource | M3uFileSource;
