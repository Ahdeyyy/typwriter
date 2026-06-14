// Persisted app settings. Frontend-owns persistence via tauri-plugin-store
// (per the phase-2 decision: no Rust settings commands). Writes are debounced.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { AppSettings } from "$lib/ipc/types";

const STORE_FILE = "settings.json";
const SAVE_DEBOUNCE_MS = 300;

function defaultBucket(): 1 | 2 | 3 | 4 {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
  return dpr >= 2 ? 3 : 2;
}

class SettingsStore {
  editorFontSize = $state(15);
  showLineNumbers = $state(false);
  autosaveMs = $state(600);
  previewScaleBucket = $state<1 | 2 | 3 | 4>(defaultBucket());
  lastWorkspace = $state<string | null>(null);
  fontsDir = $state<string | null>(null);

  private store: Store | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  /** Load persisted values once (call from the root component on mount). */
  async init() {
    if (this.loaded || typeof window === "undefined") return;
    this.loaded = true;
    try {
      this.store = await load(STORE_FILE, { autoSave: false, defaults: {} });
      const saved = await this.store.get<AppSettings>("settings");
      if (saved) {
        this.editorFontSize = saved.editorFontSize ?? this.editorFontSize;
        this.showLineNumbers = saved.showLineNumbers ?? this.showLineNumbers;
        this.autosaveMs = saved.autosaveMs ?? this.autosaveMs;
        this.previewScaleBucket = saved.previewScaleBucket ?? this.previewScaleBucket;
        this.lastWorkspace = saved.lastWorkspace ?? this.lastWorkspace;
        this.fontsDir = saved.fontsDir ?? this.fontsDir;
      }
    } catch (e) {
      console.error("settings: load failed", e);
    }
  }

  private snapshot(): AppSettings {
    return {
      editorFontSize: this.editorFontSize,
      showLineNumbers: this.showLineNumbers,
      autosaveMs: this.autosaveMs,
      previewScaleBucket: this.previewScaleBucket,
      lastWorkspace: this.lastWorkspace,
      fontsDir: this.fontsDir,
    };
  }

  /** Persist current values, debounced. Call after any setter mutation. */
  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private async flushSave() {
    if (!this.store) return;
    try {
      await this.store.set("settings", this.snapshot());
      await this.store.save();
    } catch (e) {
      console.error("settings: save failed", e);
    }
  }

  setEditorFontSize(size: number) {
    this.editorFontSize = Math.max(12, Math.min(22, Math.round(size)));
    this.save();
  }
  setShowLineNumbers(value: boolean) {
    this.showLineNumbers = value;
    this.save();
  }
  setAutosaveMs(ms: number) {
    this.autosaveMs = ms;
    this.save();
  }
  setPreviewScaleBucket(bucket: 1 | 2 | 3 | 4) {
    this.previewScaleBucket = bucket;
    this.save();
  }
  setLastWorkspace(name: string | null) {
    this.lastWorkspace = name;
    this.save();
  }
  setFontsDir(dir: string | null) {
    this.fontsDir = dir;
    this.save();
  }
}

export const settings = new SettingsStore();
