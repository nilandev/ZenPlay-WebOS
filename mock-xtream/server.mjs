// A local, fake Xtream Codes panel for demos and store screenshots.
// No dependencies: `node server.mjs` (Node 20+). See README.md.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalog, programmesFor } from "./catalog.mjs";
import { backdropSvg, logoSvg, posterSvg } from "./artwork.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const USERNAME = process.env.MOCK_USER ?? "demo";
const PASSWORD = process.env.MOCK_PASS ?? "demo";

const { vodCategories, movies, seriesCategories, series, liveCategories, channels } = catalog;
const movieById = new Map(movies.map((m) => [String(m.id), m]));
const seriesById = new Map(series.map((s) => [String(s.id), s]));
const channelById = new Map(channels.map((c) => [String(c.id), c]));

const now = () => Math.floor(Date.now() / 1000);

// Demo video, rendered once by make-video.swift (see README) — absent until then.
const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), "media");
const MOVIE_FILE = path.join(MEDIA, "movie.mp4");
const HLS_DIR = path.join(MEDIA, "hls");
const hasVideo = () => existsSync(MOVIE_FILE) && existsSync(path.join(HLS_DIR, "segments.json"));

// --- Responses -----------------------------------------------------------------

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": type.startsWith("image/") ? "public, max-age=86400" : "no-store",
  });
  res.end(body);
}

const json = (res, body) => send(res, 200, JSON.stringify(body), "application/json; charset=utf-8");
const svg = (res, body) => send(res, 200, body, "image/svg+xml");

/** Absolute URLs built from the request's own Host, so the same data works on localhost, a LAN IP or the simulator. */
function baseOf(req) {
  return `http://${req.headers.host ?? `localhost:${PORT}`}`;
}

// --- player_api.php ------------------------------------------------------------

function userInfo(req) {
  const host = (req.headers.host ?? "localhost").split(":");
  return {
    user_info: {
      username: USERNAME,
      password: PASSWORD,
      message: "Welcome to the ZenPlay demo server",
      auth: 1,
      status: "Active",
      exp_date: String(now() + 365 * 86400),
      is_trial: "0",
      active_cons: "0",
      created_at: String(now() - 200 * 86400),
      max_connections: "2",
      allowed_output_formats: ["m3u8", "ts"],
    },
    server_info: {
      url: host[0],
      port: host[1] ?? "80",
      https_port: "443",
      server_protocol: "http",
      timezone: "UTC",
      timestamp_now: now(),
      time_now: new Date().toISOString().replace("T", " ").slice(0, 19),
    },
  };
}

const byCategory = (list, categoryId) => (categoryId ? list.filter((item) => item.categoryId === categoryId) : list);

function vodStream(base, m, index) {
  return {
    num: index + 1,
    name: `${m.title} (${m.year})`,
    stream_type: "movie",
    stream_id: m.id,
    stream_icon: `${base}/art/poster/movie/${m.id}.svg`,
    rating: m.rating,
    rating_5based: Number((Number(m.rating) / 2).toFixed(1)),
    added: String(m.added),
    category_id: m.categoryId,
    container_extension: "mp4",
  };
}

function seriesEntry(base, s, index) {
  return {
    num: index + 1,
    name: `${s.title} (${s.year})`,
    series_id: s.id,
    cover: `${base}/art/poster/series/${s.id}.svg`,
    plot: s.plot,
    cast: s.cast,
    director: s.director,
    genre: s.genre,
    releaseDate: `${s.year}-01-01`,
    last_modified: String(s.lastModified),
    rating: s.rating,
    rating_5based: Number((Number(s.rating) / 2).toFixed(1)),
    backdrop_path: [`${base}/art/backdrop/series/${s.id}.svg`],
    category_id: s.categoryId,
  };
}

function liveStream(base, c) {
  return {
    num: c.num,
    name: c.name,
    stream_type: "live",
    stream_id: c.id,
    stream_icon: `${base}/art/logo/${c.id}.svg`,
    epg_channel_id: c.epgId,
    added: String(now() - 400 * 86400),
    category_id: c.categoryId,
    tv_archive: c.archive ? 1 : 0,
    tv_archive_duration: c.archive ? 7 : 0,
  };
}

function seriesInfo(base, s) {
  const episodes = {};
  for (const [season, list] of Object.entries(s.seasons)) {
    episodes[season] = list.map((ep) => ({
      id: ep.id,
      episode_num: ep.episode_num,
      title: ep.title,
      container_extension: "mp4",
      season: ep.season,
      info: {
        movie_image: `${base}/art/still/${s.id}/${ep.id}.svg`,
        plot: ep.plot,
        releasedate: ep.airDate,
        rating: ep.rating,
        duration_secs: ep.durationSecs,
        duration: new Date(ep.durationSecs * 1000).toISOString().slice(11, 19),
      },
    }));
  }
  return {
    seasons: Object.keys(s.seasons).map((n) => ({ season_number: Number(n), name: `Season ${n}`, episode_count: s.seasons[n].length, cover: `${base}/art/poster/series/${s.id}.svg` })),
    info: { ...seriesEntry(base, s, 0), name: s.title },
    episodes,
  };
}

function vodInfo(base, m) {
  return {
    info: {
      name: m.title,
      movie_image: `${base}/art/poster/movie/${m.id}.svg`,
      backdrop_path: [`${base}/art/backdrop/movie/${m.id}.svg`],
      plot: m.plot,
      description: m.plot,
      genre: m.genre,
      director: m.director,
      cast: m.cast,
      releasedate: `${m.year}-${String((m.id % 12) + 1).padStart(2, "0")}-15`,
      rating: m.rating,
      duration_secs: m.durationSecs,
      duration: new Date(m.durationSecs * 1000).toISOString().slice(11, 19),
    },
    movie_data: { stream_id: m.id, name: m.title, added: String(m.added), category_id: m.categoryId, container_extension: "mp4" },
  };
}

function shortEpg(c, limit) {
  const t = now();
  const list = programmesFor(c, t - 3 * 3600, t + 24 * 3600).filter((p) => p.stop > t - 3 * 3600);
  return {
    epg_listings: list.slice(0, limit).map((p, i) => ({
      id: String(c.id * 10000 + i),
      epg_id: c.epgId,
      channel_id: c.epgId,
      title: Buffer.from(p.title).toString("base64"),
      description: Buffer.from(p.description).toString("base64"),
      lang: "en",
      start: new Date(p.start * 1000).toISOString().replace("T", " ").slice(0, 19),
      end: new Date(p.stop * 1000).toISOString().replace("T", " ").slice(0, 19),
      start_timestamp: String(p.start),
      stop_timestamp: String(p.stop),
      has_archive: c.archive && p.stop < t ? 1 : 0,
    })),
  };
}

function playerApi(req, res, query) {
  if (query.get("username") !== USERNAME || query.get("password") !== PASSWORD) {
    return json(res, { user_info: { auth: 0 } });
  }
  const base = baseOf(req);
  const categoryId = query.get("category_id") ?? undefined;
  switch (query.get("action")) {
    case null:
    case "":
      return json(res, userInfo(req));
    case "get_live_categories":
      return json(res, liveCategories);
    case "get_vod_categories":
      return json(res, vodCategories);
    case "get_series_categories":
      return json(res, seriesCategories);
    case "get_live_streams":
      return json(res, byCategory(channels, categoryId).map((c) => liveStream(base, c)));
    case "get_vod_streams":
      return json(res, byCategory(movies, categoryId).map((m, i) => vodStream(base, m, i)));
    case "get_series":
      return json(res, byCategory(series, categoryId).map((s, i) => seriesEntry(base, s, i)));
    case "get_series_info": {
      const s = seriesById.get(query.get("series_id") ?? "");
      return s ? json(res, seriesInfo(base, s)) : json(res, { info: {}, episodes: {} });
    }
    case "get_vod_info": {
      const m = movieById.get(query.get("vod_id") ?? "");
      return m ? json(res, vodInfo(base, m)) : json(res, { info: {} });
    }
    case "get_short_epg":
    case "get_simple_data_table":
    case "get_epg": {
      const c = channelById.get(query.get("stream_id") ?? "");
      return json(res, c ? shortEpg(c, Number(query.get("limit") ?? 50)) : { epg_listings: [] });
    }
    default:
      return json(res, []);
  }
}

// --- xmltv.php -----------------------------------------------------------------

function xmlEscape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function xmltvTime(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
}

function xmltv(req) {
  const base = baseOf(req);
  const t = now();
  const from = t - 6 * 3600;
  const to = t + 3 * 86400;
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="zenplay-mock-xtream">'];
  for (const c of channels) {
    parts.push(`<channel id="${xmlEscape(c.epgId)}"><display-name>${xmlEscape(c.name)}</display-name><icon src="${base}/art/logo/${c.id}.svg"/></channel>`);
  }
  for (const c of channels) {
    for (const p of programmesFor(c, from, to)) {
      parts.push(
        `<programme start="${xmltvTime(p.start)}" stop="${xmltvTime(p.stop)}" channel="${xmlEscape(c.epgId)}"><title lang="en">${xmlEscape(p.title)}</title><desc lang="en">${xmlEscape(p.description)}</desc><category lang="en">${xmlEscape(p.category)}</category></programme>`,
      );
    }
  }
  parts.push("</tv>");
  return parts.join("\n");
}

// --- Artwork -------------------------------------------------------------------

function artwork(res, path) {
  const [, , kind, a, b] = path.replace(/\.svg$/, "").split("/");
  if (kind === "poster") {
    const item = a === "movie" ? movieById.get(b) : seriesById.get(b);
    if (item) return svg(res, posterSvg({ title: item.title, year: item.year, genre: item.genre, palette: item.palette }));
  }
  if (kind === "backdrop") {
    const item = a === "movie" ? movieById.get(b) : seriesById.get(b);
    if (item) return svg(res, backdropSvg({ title: item.title, palette: item.palette }));
  }
  if (kind === "still") {
    const item = seriesById.get(a);
    if (item) return svg(res, backdropSvg({ title: item.title, palette: item.palette, subtitle: b }));
  }
  if (kind === "logo") {
    const c = channelById.get(a);
    if (c) return svg(res, logoSvg({ name: c.name, palette: c.palette }));
  }
  return send(res, 404, "Not found", "text/plain");
}

// --- Video -------------------------------------------------------------------------

const NO_VIDEO = "No demo video yet: run `npm run make-video` in mock-xtream/ (see README).";

/** Serves a file with HTTP Range support — the player seeks and starts playback with range requests. */
function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (!range) {
    res.writeHead(200, { ...headers, "Content-Length": size });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] ? Number(range[1]) : size - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}

/**
 * A never-ending live playlist: the rendered segments played on a loop,
 * clocked to wall time so every channel is "live" at the same point. Each
 * wrap back to the first segment is marked as a discontinuity, since its
 * timestamps start again from zero.
 */
function livePlaylist() {
  const { durations } = JSON.parse(readFileSync(path.join(HLS_DIR, "segments.json"), "utf8"));
  const count = durations.length;
  const segment = Math.max(...durations);
  const window = 6;
  const current = Math.floor(Date.now() / 1000 / segment);
  const first = current - window + 1;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${Math.ceil(segment)}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor((first - 1) / count)}`,
    '#EXT-X-MAP:URI="/hls/init.mp4"',
  ];
  for (let g = first; g <= current; g++) {
    const index = g % count;
    if (index === 0) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXTINF:${durations[index].toFixed(3)},`, `/hls/seg${index}.m4s`);
  }
  return lines.join("\n") + "\n";
}

function video(req, res, pathname) {
  if (!hasVideo()) return send(res, 404, NO_VIDEO, "text/plain");
  // Live channels (HLS). The .ts form isn't offered, so the app's "Auto" format settles on HLS.
  if (/^\/live\/[^/]+\/[^/]+\/\d+\.m3u8$/.test(pathname)) return send(res, 200, livePlaylist(), "application/vnd.apple.mpegurl");
  const hls = /^\/hls\/(init\.mp4|seg\d+\.m4s)$/.exec(pathname);
  if (hls) {
    const file = path.join(HLS_DIR, hls[1]);
    return existsSync(file) ? sendFile(req, res, file, "video/mp4") : send(res, 404, "Not found", "text/plain");
  }
  // Films, episodes and catch-up all play the same clip.
  if (/^\/(movie|series)\/[^/]+\/[^/]+\/\d+\.\w+$/.test(pathname) || pathname === "/streaming/timeshift.php") return sendFile(req, res, MOVIE_FILE, "video/mp4");
  return send(res, 404, "No stream here.", "text/plain");
}

// --- Server --------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  if (url.pathname === "/player_api.php") return playerApi(req, res, url.searchParams);
  if (url.pathname === "/xmltv.php") {
    if (url.searchParams.get("username") !== USERNAME || url.searchParams.get("password") !== PASSWORD) return send(res, 401, "Unauthorized", "text/plain");
    return send(res, 200, xmltv(req), "application/xml; charset=utf-8");
  }
  if (url.pathname.startsWith("/art/")) return artwork(res, url.pathname);
  // /live/, /movie/, /series/, /hls/ and catch-up: the rendered demo clip.
  return video(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  console.log(`ZenPlay mock Xtream server
  Movies ${movies.length} · Series ${series.length} · Channels ${channels.length}

  Server URL:  http://localhost:${PORT}${lan ? `   (TV on your network: http://${lan}:${PORT})` : ""}
  Username:    ${USERNAME}
  Password:    ${PASSWORD}

  Video:       ${hasVideo() ? "demo clip ready (movies, episodes, catch-up and live)" : NO_VIDEO}`);
});
