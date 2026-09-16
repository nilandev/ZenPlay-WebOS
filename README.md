# Free IPTV Player

An open-source IPTV player targeting Android TV, LG webOS, Samsung Tizen,
mobile, and desktop from a single shared codebase. See [PLAN.md](./PLAN.md)
for the full architecture and tech-stack rationale.

## Repo layout

- `packages/core` — Xtream Codes client, M3U parser, XMLTV/EPG parser, shared models, remote-input keymap.
- `packages/player` — hls.js-backed playback engine abstraction + channel preloader ("zap-ahead").
- `packages/ui` — React components: spatial-navigation focus system, channel grid, video surface.
- `apps/tv` — the shared TV app (Vite + React), Capacitor-wrapped for Android TV.
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

Early scaffold: core parsers, playback engine, spatial navigation, and a
minimal live-TV browsing screen are implemented and tested. VOD/series
browsing, EPG grid UI, catch-up, profiles, parental controls, and the
webOS/Tizen native wrappers are not yet built (see PLAN.md for the intended
build order).

## License

MIT. This project is a generic IPTV player; it ships with no bundled
channels, providers, or credentials.
