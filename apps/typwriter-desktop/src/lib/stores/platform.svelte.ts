// Platform detection. Uses `@tauri-apps/plugin-os` to identify the host OS.

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";
import { homeDir } from "@tauri-apps/api/path";

export type Os = "macos" | "windows" | "linux" | "unknown";

class PlatformStore {
  os = $state<Os>("unknown");
  appVersion = $state("");
  homePath = $state<string | null>(null);

  isMac = $derived(this.os === "macos");

  // This is the desktop app (mobile ships separately), so it never runs on a
  // mobile OS. Exposed so shared desktop-only guards (e.g. the LSP client) read
  // naturally without special-casing the platform elsewhere.
  readonly isMobile = false;

  constructor() {
    if (typeof window === "undefined") return;

    try {
      this.os = tauriPlatform() as Os;
    } catch {
      this.os = "unknown";
    }

    getVersion()
      .then((version) => {
        this.appVersion = version;
      })
      .catch(() => {});

    homeDir()
      .then((path) => {
        this.homePath = path;
      })
      .catch(() => {});
  }
}

export const platform = new PlatformStore();
