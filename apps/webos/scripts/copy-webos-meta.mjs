import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(appDir, "webos-meta");
const dest = path.join(appDir, "dist");

await cp(src, dest, { recursive: true });
console.log(`Copied appinfo.json + icons from ${path.relative(appDir, src)} to ${path.relative(appDir, dest)}`);
