import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { iptvDevProxyPlugin } from "./vite-dev-proxy.js";

export default defineConfig({
  plugins: [react(), iptvDevProxyPlugin()],
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
