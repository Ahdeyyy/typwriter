import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "svelte-sonner";
import { logError } from "$lib/logger";

/**
 * The update lifecycle, in the order it advances. A single button drives the
 * whole thing: `idle` → check, `available` → download, `ready` → restart. The
 * `-ing` states are transient and leave the button disabled.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing";

class UpdaterStore {
  status = $state<UpdateStatus>("idle");
  /** Version of the pending update, once one has been found. */
  version = $state<string | null>(null);
  /**
   * Download progress, 0-100 — `null` while downloading a release whose size
   * the server didn't advertise, in which case the button omits the percentage.
   */
  progress = $state<number | null>(null);

  /** Handle from `check()`; `download()`/`install()` are methods on it. */
  #update: Update | null = null;
  /** Guards the passive check to one network round-trip per window. */
  #passiveChecked = false;

  /** `v`-prefixed version for display, whichever form the manifest used. */
  get displayVersion() {
    return this.version ? `v${this.version.replace(/^v/i, "")}` : null;
  }

  /** Transient states: the button is disabled and shows what's happening. */
  get busy() {
    return (
      this.status === "checking" ||
      this.status === "downloading" ||
      this.status === "installing"
    );
  }

  /** Called silently on app load, so the button can offer the update directly. */
  async checkPassive() {
    if (this.#passiveChecked || this.status !== "idle") return;
    this.#passiveChecked = true;
    this.status = "checking";
    try {
      const update = await check();
      if (update) {
        this.#update = update;
        this.version = update.version;
        this.status = "available";
      } else {
        this.status = "idle";
      }
    } catch {
      // silent — passive check should never bother the user
      this.status = "idle";
    }
  }

  /**
   * The one action behind the update button: takes the lifecycle one step
   * forward from wherever it currently is.
   */
  async advance() {
    switch (this.status) {
      case "idle":
        return this.#check();
      case "available":
        return this.#download();
      case "ready":
        return this.#restart();
      default:
        return; // busy — the button is disabled in these states
    }
  }

  async #check() {
    this.status = "checking";
    const id = toast.loading("Checking for updates…");
    try {
      const update = await check();
      if (!update) {
        this.status = "idle";
        toast.success("You're up to date!", { id });
        return;
      }
      this.#update = update;
      this.version = update.version;
      this.status = "available";
      toast.success(`Version ${update.version} is available.`, { id });
    } catch (err) {
      this.status = "idle";
      logError("update check failed:", err);
      toast.error(`Update check failed: ${err}`, { id });
    }
  }

  async #download() {
    const update = this.#update;
    if (!update) {
      this.status = "idle";
      return;
    }
    this.status = "downloading";
    this.progress = null;
    let downloaded = 0;
    let total = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          if (total > 0) this.progress = 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            this.progress = Math.min(
              100,
              Math.round((downloaded / total) * 100),
            );
          }
        } else if (event.event === "Finished") {
          this.progress = 100;
        }
      });
      this.progress = 100;
      this.status = "ready";
    } catch (err) {
      logError("update download failed:", err);
      toast.error(`Download failed: ${err}`);
      this.progress = null;
      this.status = "available";
    }
  }

  async #restart() {
    const update = this.#update;
    if (!update) {
      this.status = "idle";
      return;
    }
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const ok = await confirm(
      "Typwriter will close and reopen to finish installing the update. " +
        "Save any unsaved work first.",
      {
        title: this.displayVersion
          ? `Restart to update to ${this.displayVersion}`
          : "Restart to update",
        kind: "warning",
        okLabel: "Restart now",
        cancelLabel: "Later",
      },
    );
    if (!ok) return;

    this.status = "installing";
    try {
      await update.install();
      // On Windows the installer takes over and terminates the app, so this
      // line may never run; on macOS/Linux it's what brings the app back.
      await relaunch();
    } catch (err) {
      logError("update install failed:", err);
      toast.error(`Couldn't install the update: ${err}`);
      this.status = "ready";
    }
  }
}

export const updater = new UpdaterStore();
