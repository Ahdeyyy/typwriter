import { check } from "@tauri-apps/plugin-updater";
import { toast } from "svelte-sonner";

class UpdaterStore {
  checking = $state(false);
  available = $state(false);
  downloading = $state(false);
  progress = $state(0); // 0-100

  /** Called silently on app load. Sets available=true if an update is found. */
  async checkPassive() {
    if (this.checking) return;
    this.checking = true;
    try {
      const update = await check();
      if (update?.available) this.available = true;
    } catch {
      // silent — passive check should never bother the user
    } finally {
      this.checking = false;
    }
  }

  /** Called from the menu bar. Shows toasts and downloads the update. */
  async checkManual() {
    if (this.checking || this.downloading) return;
    this.checking = true;
    const id = toast.loading("Checking for updates…");
    try {
      const update = await check();
      if (!update?.available) {
        toast.success("You're up to date!", { id });
        return;
      }
      this.available = true;
      toast.success(`v${update.version} available — downloading…`, { id });
      this.downloading = true;
      let downloaded = 0;
      let total = 0;
      const dlId = toast.loading("Downloading… 0%");
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            this.progress = Math.round((downloaded / total) * 100);
            toast.loading(`Downloading… ${this.progress}%`, { id: dlId });
          }
        } else if (event.event === "Finished") {
          this.progress = 100;
          toast.success("Update installed — restart to apply.", { id: dlId });
        }
      });
    } catch (err) {
      toast.error(`Update check failed: ${err}`, { id });
    } finally {
      this.checking = false;
      this.downloading = false;
    }
  }
}

export const updater = new UpdaterStore();
