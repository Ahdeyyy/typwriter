// Update check. Tauri's updater doesn't cover Android, so `check_for_update`
// reads this track's android.json, and installing means opening the APK in the
// browser: Android installs it over this app (same signing key, newer version)
// and keeps its data.

import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "svelte-sonner";
import { checkForUpdate } from "#lib/ipc/commands.ts";
import type { UpdateInfo } from "#lib/ipc/types.ts";
import { settings } from "./settings.svelte";

const PASSIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "failed";

export class UpdaterStore {
  status = $state<UpdateStatus>("idle");
  update = $state<UpdateInfo | null>(null);

  /** Launch check: at most once a day, and silent unless there is an update. */
  async checkPassive() {
    await settings.init();
    const elapsed = Date.now() - settings.lastUpdateCheck;
    // A clock set backwards makes `elapsed` negative: check rather than wait.
    if (elapsed >= 0 && elapsed < PASSIVE_INTERVAL_MS) return;
    const update = await this.check();
    if (update) {
      toast(`Version ${update.version} is available`, {
        duration: 10_000,
        action: { label: "Download", onClick: () => this.download() },
      });
    }
  }

  /** Behind the settings row; resolves to the update, if there is one. */
  async check(): Promise<UpdateInfo | null> {
    if (this.status === "checking") return null;
    this.status = "checking";
    return checkForUpdate().match(
      (update) => {
        settings.setLastUpdateCheck(Date.now());
        this.update = update;
        this.status = update ? "available" : "up-to-date";
        return update;
      },
      (error) => {
        console.error("update check failed:", error);
        this.status = "failed";
        return null;
      },
    );
  }

  download() {
    if (!this.update) return;
    openUrl(this.update.url).catch(() => toast.error("Couldn't open the download"));
  }
}

export const updater = new UpdaterStore();
