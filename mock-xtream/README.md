# Mock Xtream server

A local, fake Xtream Codes panel for running ZenPlay without a real IPTV
subscription — for demos, development and app-store screenshots.

Everything it serves is invented: film and series titles, channel names,
people, plots and the TV guide. Posters, backdrops, episode stills and
channel logos are drawn as SVG from each title, so there are no third-party
images, brands or streams involved. The catalogue is seeded, so every run
serves exactly the same content and screenshots can be retaken identically.

## Run

```sh
pnpm mock:xtream            # from the repo root
# or
cd mock-xtream && npm start
```

No dependencies — Node 20+ only. It prints the server URL (and the one to use
from a TV on your network) with the login:

| Field    | Value                   |
| -------- | ----------------------- |
| Server   | `http://localhost:8787` |
| Username | `demo`                  |
| Password | `demo`                  |

Add it in ZenPlay as an **Xtream Codes** playlist with those details.

Options (environment variables): `PORT` (default `8787`), `HOST` (default
`0.0.0.0`), `MOCK_USER`, `MOCK_PASS`.

- **webOS TV Simulator / desktop browser:** `http://localhost:8787`.
- **A real TV:** use the LAN address the server prints, e.g.
  `http://192.168.1.58:8787` (the Mac and TV must be on the same network).

## What's in it

- ~120 movies in 10 categories, ~60 series in 8 categories (1–4 seasons,
  6–10 episodes each), ~55 live channels in 8 groups.
- Plots, cast, director, ratings, release years, durations.
- A TV guide: `xmltv.php` (6 hours back to 3 days ahead) and `get_epg`.
- Catch-up flags on News, Sports, Entertainment and Documentary channels.
- "Animation Movies" and "Kids Series" categories, which the Kids profile's
  bundled rules pick up.
- Movie and series names come as "Title (Year)", the way many panels send them.

## Video

Pressing play shows a demo clip: an original animated sunset over drifting
mountains, rendered on your Mac (no footage, text or logos). Render it once
before starting the server:

```sh
cd mock-xtream && npm run make-video     # ~1–2 minutes; needs the Xcode command line tools (swift)
```

It writes `media/` (git-ignored, ~65 MB):

- `movie.mp4` — a 90-second 1080p clip, played for every film, episode and
  catch-up programme (with seeking).
- `hls/` — 60 seconds of HLS segments that every live channel plays as a
  never-ending live stream, looping on the wall clock.

Without `media/`, the catalogue still works and play shows the player's
error state. Live channels are offered as HLS only, so leave **Live Stream
Format** on Auto (or HLS).

## Endpoints

`/player_api.php` — sign-in (no action), `get_live_categories`,
`get_vod_categories`, `get_series_categories`, `get_live_streams`,
`get_vod_streams`, `get_series` (all accept `category_id`),
`get_series_info`, `get_vod_info`, `get_epg` / `get_short_epg`.
`/xmltv.php` — full guide. `/art/…` — generated SVG artwork.
`/movie/…`, `/series/…`, `/streaming/timeshift.php` — the demo MP4.
`/live/…/<id>.m3u8` and `/hls/…` — the looping live stream.

## Files

- `catalog.mjs` — the invented content and the seeded generator.
- `artwork.mjs` — SVG posters, backdrops, stills and logos.
- `server.mjs` — the HTTP server.
- `make-video.swift` — renders the demo clip into `media/`.

Before publishing screenshots, check the titles on screen once more; they're
invented, but a short generic title can coincide with a real work.
