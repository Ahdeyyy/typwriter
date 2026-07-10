// Platform detection. Uses `@tauri-apps/plugin-os` to identify the host OS.

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";

export type Os = "macos" | "windows" | "linux" | "unknown";

class PlatformStore {
  os = $state<Os>("unknown");
  appVersion = $state("");

  isMac = $derived(this.os === "macos");

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
  }
}

export const platform = new PlatformStore();
