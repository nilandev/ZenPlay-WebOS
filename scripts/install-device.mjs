import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webosDistDir = path.join(appDir, "webos-dist");

const deviceName = process.argv[2];
if (!deviceName) {
  console.error("Usage: pnpm install-device <deviceName>  (see `ares-setup-device --list` for registered names)");
  process.exit(1);
}

const ipkFiles = (await readdir(webosDistDir)).filter((f) => f.endsWith(".ipk"));
if (ipkFiles.length === 0) {
  console.error(`No .ipk found in ${webosDistDir} — run \`pnpm package\` first.`);
  process.exit(1);
}
// Package filenames embed the version (e.g. app_0.1.0_all.ipk); if multiple
// exist from prior builds, the most recently modified one is the intended target.
const latestIpk = ipkFiles.sort().at(-1);

const result = spawnSync("ares-install", ["--device", deviceName, path.join(webosDistDir, latestIpk)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
