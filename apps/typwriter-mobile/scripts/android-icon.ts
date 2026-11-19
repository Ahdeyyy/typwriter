// Install the adaptive launcher icon over what `tauri icon` generated.
//
// `tauri icon` puts the whole app-icon.png tile into the adaptive foreground
// layer, so every launcher mask crops it. src-tauri/android-icon/ holds real
// layers instead: a full-bleed background, the glyph inside the safe zone, and
// a monochrome layer for themed icons. Run after `tauri icon` (`bun run icons`).
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(app, "src-tauri/android-icon");
const res = join(app, "src-tauri/gen/android/app/src/main/res");

if (!existsSync(res)) {
  console.error("No Android project at src-tauri/gen/android — run `bun tauri android init` first.");
  process.exit(1);
}

cpSync(source, res, { recursive: true });
console.log(`Installed adaptive launcher icon into ${res}`);
