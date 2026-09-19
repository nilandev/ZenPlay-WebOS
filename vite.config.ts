import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { iptvDevProxyPlugin } from "./vite-dev-proxy.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(rootDir, "package.json"), "utf-8")) as { version: string };

// Best-effort short commit hash for the Settings > About screen — falls back
// to "dev" outside a git checkout (e.g. a source tarball) rather than
// failing the build.
function getBuildId(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: rootDir }).toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(getBuildId()),
  },
  // webOS TV loads the packaged app from its own local app directory, not
  // from a web server root — an absolute "/assets/..." base (Vite's
  // default) 404s there, since there's no server to resolve "/" against.
  // Relative asset paths work both in the packaged app and in `vite dev`
  // (dev server serves everything from "/" anyway, so this is a no-op
  // there) and in `ares-launch --hosted`.
  base: "./",
  plugins: [react(), iptvDevProxyPlugin()],
  resolve: {
    alias: {
      "@core": path.resolve(rootDir, "src/core/index.ts"),
      "@player": path.resolve(rootDir, "src/player/index.ts"),
      "@ui": path.resolve(rootDir, "src/ui/index.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    // webOS TV 6.0 (2021+) ships Chromium 79; this is the floor we target
    // (see docs/webos.md). Older webOS TV versions (5.x and below, pre-Blink
    // 1.x/2.x) are not supported.
    target: "chrome79",
  },
});
