/// <reference types="vite/client" />

/** App version from package.json, injected at build time — see vite.config.ts. */
declare const __APP_VERSION__: string;

/** Short git commit hash at build time, or "dev" outside a git checkout — see vite.config.ts. */
declare const __BUILD_ID__: string;
