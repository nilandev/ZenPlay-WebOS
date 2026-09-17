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
    target: "es2018",
  },
});
