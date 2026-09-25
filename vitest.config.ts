import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Mirrors vite.config.ts's define block — HomeScreen (and anything else
  // reading these build-time globals) would otherwise throw a
  // ReferenceError under Vitest, which doesn't apply vite.config.ts's own
  // config. Test-only placeholder values; the real build stamps the actual
  // package version/commit hash.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
    __BUILD_ID__: JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
  // Mirrors vite.config.ts's path aliases so test files (e.g.
  // sync/sync-manager.ts, which imports PlaylistSource from "@core") resolve
  // the same way under Vitest as they do in the real app build.
  resolve: {
    alias: {
      "@core": path.resolve(rootDir, "src/core/index.ts"),
      "@player": path.resolve(rootDir, "src/player/index.ts"),
      "@ui": path.resolve(rootDir, "src/ui/index.ts"),
    },
  },
});
