// Install the adaptive launcher icon over what `tauri icon` generated.
//
// `tauri icon` puts the whole app-icon.png tile into the adaptive foreground
// layer, so every launcher mask crops it. src-tauri/android-icon/ holds real
// layers instead: a full-bleed background, the glyph inside the safe zone, and
// a monochrome layer for themed icons. Run after `tauri icon` (`bun run icons`).
//
// `nightly` (`bun run icons:nightly`) then lays src-tauri/android-icon-nightly/
// on top, which only swaps the background for the nightly build's blue one.
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(app, "src-tauri/gen/android/app/src/main/res");
const channel = process.argv[2] ?? "stable";

if (channel !== "stable" && channel !== "nightly") {
  console.error(`Unknown channel "${channel}" — expected "stable" or "nightly".`);
  process.exit(1);
}

if (!existsSync(res)) {
  console.error("No Android project at src-tauri/gen/android — run `bun tauri android init` first.");
  process.exit(1);
}

cpSync(join(app, "src-tauri/android-icon"), res, { recursive: true });
if (channel === "nightly") {
  cpSync(join(app, "src-tauri/android-icon-nightly"), res, { recursive: true });
}
console.log(`Installed ${channel} adaptive launcher icon into ${res}`);
