import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logError } from "#lib/logger.ts";

/**
 * The update lifecycle, in the order it advances. One action drives the whole
 * thing: `idle` → check, `available` → download, `ready` → restart. The `-ing`
 * states are transient and leave the action disabled.
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
  /** Bytes fetched so far, and the advertised size (0 when unknown). */
  downloadedBytes = $state(0);
  totalBytes = $state(0);
  /** Smoothed download rate, bytes per second; 0 until there's a sample. */
  bytesPerSecond = $state(0);
  /** Release notes and publish date from the update manifest. */
  notes = $state<string | null>(null);
  releaseDate = $state<Date | null>(null);
  /** When the last check finished, and whether it found nothing newer. */
  checkedAt = $state<Date | null>(null);
  upToDate = $state(false);
  /** Why the last step failed, shown inline until the next attempt. */
  error = $state<string | null>(null);

  /** Handle from `check()`; `download()`/`install()` are methods on it. */
  #update: Update | null = null;
  /** Guards the passive check to one network round-trip per window. */
  #passiveChecked = false;

  /** `v`-prefixed version for display, whichever form the manifest used. */
  get displayVersion() {
    return this.version ? `v${this.version.replace(/^v/i, "")}` : null;
  }

  /** Seconds left at the current rate, or null when it can't be estimated. */
  get secondsLeft() {
    if (this.status !== "downloading" || !this.totalBytes || !this.bytesPerSecond) return null;
    return Math.max(0, (this.totalBytes - this.downloadedBytes) / this.bytesPerSecond);
  }

  /** Transient states: the action is disabled and the UI shows progress. */
  get busy() {
    return (
      this.status === "checking" ||
      this.status === "downloading" ||
      this.status === "installing"
    );
  }

  /** Called silently on app load, so the UI can offer the update directly. */
  async checkPassive() {
    if (this.#passiveChecked || this.status !== "idle") return;
    this.#passiveChecked = true;
    this.status = "checking";
    try {
      this.#found(await check());
    } catch {
      // silent — passive check should never bother the user
      this.status = "idle";
    }
  }

  #found(update: Update | null) {
    this.checkedAt = new Date();
    this.upToDate = !update;
    if (!update) {
      this.status = "idle";
      return;
    }
    this.#update = update;
    this.version = update.version;
    this.notes = update.body?.trim() || null;
    const date = update.date ? new Date(update.date) : null;
    this.releaseDate = date && !Number.isNaN(date.getTime()) ? date : null;
    this.status = "available";
  }

  /**
   * The one action behind the update card: takes the lifecycle one step
   * forward from wherever it currently is.
   */
  async advance() {
    this.error = null;
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
    try {
      this.#found(await check());
    } catch (err) {
      this.status = "idle";
      logError("update check failed:", err);
      this.error = `Couldn't reach the update server. ${err}`;
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
    this.downloadedBytes = 0;
    this.totalBytes = 0;
    this.bytesPerSecond = 0;
    let downloaded = 0;
    let total = 0;
    // Chunks arrive far faster than anyone reads; publish to the UI (and take
    // a rate sample) at most every SAMPLE_MS.
    const SAMPLE_MS = 250;
    let lastSampleAt = performance.now();
    let lastSampleBytes = 0;
    const publish = () => {
      this.downloadedBytes = downloaded;
      if (total > 0) this.progress = Math.min(100, Math.round((downloaded / total) * 100));
    };
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          this.totalBytes = total;
          if (total > 0) this.progress = 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const now = performance.now();
          const elapsed = now - lastSampleAt;
          if (elapsed >= SAMPLE_MS) {
            const rate = ((downloaded - lastSampleBytes) * 1000) / elapsed;
            // Exponential smoothing keeps the ETA from jittering.
            this.bytesPerSecond = this.bytesPerSecond
              ? this.bytesPerSecond * 0.7 + rate * 0.3
              : rate;
            lastSampleAt = now;
            lastSampleBytes = downloaded;
            publish();
          }
        } else if (event.event === "Finished") {
          publish();
        }
      });
      this.downloadedBytes = downloaded;
      this.progress = 100;
      this.status = "ready";
    } catch (err) {
      logError("update download failed:", err);
      this.error = `The download didn't finish. ${err}`;
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
      this.error = `Couldn't install the update. ${err}`;
      this.status = "ready";
    }
  }
}

export const updater = new UpdaterStore();
