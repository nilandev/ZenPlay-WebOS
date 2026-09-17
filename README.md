# Free IPTV Player

An open-source IPTV player targeting Android TV, LG webOS, Samsung Tizen,
mobile, and desktop from a single shared codebase. See [PLAN.md](./PLAN.md)
for the full architecture and tech-stack rationale.

## Repo layout

- `packages/core` — Xtream Codes client, M3U parser, XMLTV/EPG parser (+ now/next lookup), profile/PIN models, shared models, remote-input keymap.
- `packages/player` — hls.js-backed playback engine abstraction + channel preloader ("zap-ahead").
- `packages/ui` — React components: scoped spatial-navigation focus system, channel grid, EPG grid, Apple-TV-style focus cards/shelves/backdrop, top nav, video surface.
- `apps/tv` — the shared TV app (Vite + React): profiles, live TV, EPG guide, movies, series, settings/parental controls. Capacitor-wrapped for Android TV.
- `platform/webos`, `platform/tizen` — native app wrappers (not yet scaffolded).
- `docs/` — setup and testing guides.

## Getting started

```bash
pnpm install
pnpm build       # builds packages in dependency order: core → player → ui
pnpm test        # unit tests across all packages
pnpm --filter @iptv/tv dev   # run the app in a browser at http://localhost:5173
```

See [docs/testing.md](./docs/testing.md) for the full testing guide and
[docs/android-tv.md](./docs/android-tv.md) for building/running on Android TV.

## Status

Core parsers, playback engine, spatial navigation, and the full v1 feature
set are implemented and tested: live TV, EPG guide with catch-up/timeshift
playback, movies and series browsing (Apple-TV-inspired shelves/backdrop),
multi-profile support, and parental-control PIN locks on categories. Screen
content is cached per session (in-memory + sessionStorage) with matching
loading-shimmer skeletons, so navigating between tabs or reloading doesn't
show an empty screen while data refetches. Not yet built: the native
ExoPlayer bridge for Android TV, IndexedDB persistence (currently
localStorage/sessionStorage), and the webOS/Tizen native wrappers (see
PLAN.md for the intended build order).

## License

MIT. This project is a generic IPTV player; it ships with no bundled
channels, providers, or credentials.
