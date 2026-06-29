// Platform detection. Uses `@tauri-apps/plugin-os` to identify the host OS
// and classifies android/ios as mobile.

import { platform as tauriPlatform } from "@tauri-apps/plugin-os";
import { documentDir } from "@tauri-apps/api/path";
import { getVersion } from "@tauri-apps/api/app";
import { normalize } from "$lib/paths";

export type Os = "macos" | "windows" | "linux" | "android" | "ios" | "unknown";
export type FormFactor = "desktop" | "mobile";

class PlatformStore {
  os = $state<Os>("unknown");
  documentsDirPrefix = $state("");
  appVersion = $state("");

  isMobile = $derived(this.os === "android" || this.os === "ios");
  isDesktop = $derived(!this.isMobile);
  formFactor = $derived<FormFactor>(this.isMobile ? "mobile" : "desktop");
  hasDesktopWindowControls = $derived(this.isDesktop);
  isMac = $derived(this.os === "macos");

  constructor() {
    if (typeof window === "undefined") return;

    try {
      this.os = tauriPlatform() as Os;
    } catch {
      this.os = "unknown";
    }

    this.loadDocumentsDirPrefix();
    this.loadAppVersion();
  }

  private loadDocumentsDirPrefix() {
    documentDir()
      .then((dir) => {
        this.documentsDirPrefix = dir;
      })
      .catch(() => {});
  }

  private loadAppVersion() {
    getVersion()
      .then((version) => {
        this.appVersion = version;
      })
      .catch(() => {});
  }

  /** Strip the `<documents>/` prefix from a path when on mobile so the
   *  user sees a workspace-relative path instead of the long app-private
   *  external-storage path. */
  displayPath(path: string): string {
    if (!path) return path;
    if (!this.isMobile || !this.documentsDirPrefix) return path;
    const normalized = normalize(path);
    const prefix = normalize(this.documentsDirPrefix).replace(/\/$/, "");
    if (normalized.startsWith(prefix + "/")) {
      return normalized.slice(prefix.length + 1);
    }
    if (normalized === prefix) return "";
    return path;
  }
}

export const platform = new PlatformStore();
