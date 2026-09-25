# Contributing to ZenPlay

Thanks for taking the time to contribute! This guide explains how to get
set up and what we look for in a pull request.

By taking part in this project you agree to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs.** Open a [bug report](https://github.com/nilandev/zenplay/issues/new?template=bug_report.yml).
  Include your TV model and webOS version if the bug happens on a device.
- **Test on real hardware.** Reports from different LG TV models are very
  valuable, even when everything works.
- **Suggest features.** Open a [feature request](https://github.com/nilandev/zenplay/issues/new?template=feature_request.yml)
  so we can discuss it before you spend time on code.
- **Send a pull request.** Bug fixes, tests and docs are always welcome.
  For larger changes, please open an issue first.

## Development setup

You need Node.js 20+ and pnpm 9+.

```bash
git clone https://github.com/<your-username>/zenplay.git
cd zenplay
pnpm install
pnpm dev        # http://localhost:5173
```

In the browser, use the arrow keys as the D-pad, `Enter` to select and
`Escape` to go back. See the [README](README.md#running-on-an-lg-tv) for
running on a TV or the webOS TV Simulator.

## Before you open a pull request

Run these and make sure they all pass. CI runs the same checks.

```bash
pnpm typecheck
pnpm test
pnpm build
```

Also check:

- **It works with the remote alone.** Every interactive element must be
  reachable and usable with the D-pad (arrow keys) and `Enter`/Back, with
  no mouse. New screens should register their focusable elements with the
  focus system in `src/ui/focus/`.
- **Tests cover the change.** Add or update tests next to the code you
  change (`*.test.ts` / `*.test.tsx`).
- **Provider requests go through `proxyFetch`.** If you add a `fetch()` to
  a provider URL, use `proxyFetch` from `src/proxy-fetch.ts` so it works in
  the dev server.
- **It targets webOS TV 6.0 (Chromium 79).** Avoid browser APIs or CSS
  features newer than that without a fallback.
- **No secrets.** Never commit real provider URLs, usernames, passwords or
  playlists, including in tests, screenshots or issue text.

## Pull request guidelines

1. Fork the repo and create a branch from `main` (for example
   `fix/epg-timezone` or `feat/search`).
2. Keep each pull request focused on one change.
3. Write clear commit messages in the imperative mood ("Fix guide scroll",
   not "Fixed guide scroll").
4. Fill in the pull request template, and add screenshots or a short
   video for UI changes.
5. Be ready for review feedback. We'll try to respond within a few days.

## Code style

- TypeScript with `strict` mode; avoid `any`.
- Match the style of the surrounding code: naming, file layout and
  comment density.
- Use the `@core`, `@player` and `@ui` path aliases rather than long
  relative imports across those folders.

## License

By contributing, you agree that your contributions will be licensed under
the [MIT License](LICENSE).
