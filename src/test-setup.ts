// Global Vitest setup. jsdom itself has no IndexedDB implementation, and
// content-cache.ts's persistent tier (src/core/storage/indexeddb-store.ts)
// needs a real one to exercise actual transaction/structured-clone
// semantics rather than a hand-rolled mock — fake-indexeddb/auto installs a
// full in-memory IndexedDB onto the global scope for every test file.
import "fake-indexeddb/auto";

// This project previously had no setupFiles wired into vitest.config.ts, so
// React Testing Library's auto-cleanup-after-each-test didn't run
// implicitly — existing component tests (e.g. LiveOverlayGrid.test.tsx) work
// around this with their own explicit afterEach(() => cleanup()). Registering
// it here once makes that automatic for every test file going forward
// (harmless double-cleanup alongside those existing explicit calls, since
// cleanup() on an already-clean DOM is a no-op).
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
