// Platform detection.
//
// Two detection modes are supported:
//   - "viewport" (default): treat <768px viewports as mobile. Useful during
//     dev because resizing the desktop window flips the layout, so mobile
//     work can be done without an emulator.
//   - "tauri": ask `@tauri-apps/plugin-os` what OS we're running on, and
//     classify android/ios as mobile. Use this once the Android build is
//     stable enough that real-device behavior is the source of truth.
//
// Switch via the `VITE_PLATFORM_MODE` env var (set in `.env` or the shell).

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";

const MOBILE_MAX_WIDTH = 768;

type Mode = "viewport" | "tauri";
const MODE: Mode =
  (import.meta.env.VITE_PLATFORM_MODE as Mode | undefined) ?? "viewport";

class PlatformStore {
  width = $state(typeof window !== "undefined" ? window.innerWidth : 1024);
  os = $state<string | null>(null);

  isMobile = $derived(
    MODE === "tauri"
      ? this.os === "android" || this.os === "ios"
      : this.width < MOBILE_MAX_WIDTH,
  );
  isDesktop = $derived(!this.isMobile);
  mode = MODE;

  constructor() {
    if (typeof window === "undefined") return;

    if (MODE === "viewport") {
      window.addEventListener("resize", () => {
        this.width = window.innerWidth;
      });
    } else {
      // Resolve the OS once on startup; it doesn't change at runtime.
      tauriPlatform()
        .then((os) => {
          this.os = os;
        })
        .catch(() => {
          // Plugin unavailable (e.g. running outside Tauri); fall back to
          // viewport so the UI doesn't get stuck in an indeterminate state.
          this.os = "unknown";
        });
    }
  }
}

export const platform = new PlatformStore();
