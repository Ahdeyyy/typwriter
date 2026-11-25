// Persisted app settings. The frontend owns persistence via tauri-plugin-store;
// there are no Rust settings commands. Writes are debounced.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { AppSettings } from "#lib/ipc/types.ts";

const STORE_FILE = "settings.json";
const SAVE_DEBOUNCE_MS = 300;

function defaultBucket(): 1 | 2 | 3 | 4 {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
  return dpr >= 2 ? 3 : 2;
}

export class SettingsStore {
  editorFontSize = $state(15);
  showLineNumbers = $state(false);
  showInlineTitle = $state(true);
  hideChromeOnScroll = $state(true);
  autosaveMs = $state(600);
  previewScaleBucket = $state<1 | 2 | 3 | 4>(defaultBucket());
  lastWorkspace = $state<string | null>(null);
  fontsDir = $state<string | null>(null);
  lastExportFormat = $state<"pdf" | "png" | "svg" | "html">("pdf");
  lastPdfStandard = $state<string>("1.7");
  lastPngScale = $state<number>(2.0);
  lastPackageMode = $state<"zip" | "folder">("zip");
  lastUpdateCheck = $state(0);

  private store: Store | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private initPromise: Promise<void> | null = null;

  /** Concurrent callers wait for the same hydration; a failed load may retry. */
  init(): Promise<void> {
    if (this.loaded || typeof window === "undefined") return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.loadSettings().finally(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  private async loadSettings(): Promise<void> {
    try {
      const store = await load(STORE_FILE, { autoSave: false, defaults: {} });
      const saved = await store.get<AppSettings>("settings");
      if (saved) {
        this.editorFontSize = saved.editorFontSize ?? this.editorFontSize;
        this.showLineNumbers = saved.showLineNumbers ?? this.showLineNumbers;
        this.showInlineTitle = saved.showInlineTitle ?? this.showInlineTitle;
        this.hideChromeOnScroll = saved.hideChromeOnScroll ?? this.hideChromeOnScroll;
        this.autosaveMs = saved.autosaveMs ?? this.autosaveMs;
        this.previewScaleBucket = saved.previewScaleBucket ?? this.previewScaleBucket;
        this.lastWorkspace = saved.lastWorkspace ?? this.lastWorkspace;
        this.fontsDir = saved.fontsDir ?? this.fontsDir;
        this.lastExportFormat = saved.lastExportFormat ?? this.lastExportFormat;
        this.lastPdfStandard = saved.lastPdfStandard ?? this.lastPdfStandard;
        this.lastPngScale = saved.lastPngScale ?? this.lastPngScale;
        this.lastPackageMode = saved.lastPackageMode ?? this.lastPackageMode;
        this.lastUpdateCheck = saved.lastUpdateCheck ?? this.lastUpdateCheck;
      }
      this.store = store;
      this.loaded = true;
    } catch (e) {
      console.error("settings: load failed", e);
    }
  }

  private snapshot(): AppSettings {
    return {
      editorFontSize: this.editorFontSize,
      showLineNumbers: this.showLineNumbers,
      showInlineTitle: this.showInlineTitle,
      hideChromeOnScroll: this.hideChromeOnScroll,
      autosaveMs: this.autosaveMs,
      previewScaleBucket: this.previewScaleBucket,
      lastWorkspace: this.lastWorkspace,
      fontsDir: this.fontsDir,
      lastExportFormat: this.lastExportFormat,
      lastPdfStandard: this.lastPdfStandard,
      lastPngScale: this.lastPngScale,
      lastPackageMode: this.lastPackageMode,
      lastUpdateCheck: this.lastUpdateCheck,
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
  setShowInlineTitle(value: boolean) {
    this.showInlineTitle = value;
    this.save();
  }
  setHideChromeOnScroll(value: boolean) {
    this.hideChromeOnScroll = value;
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
  setLastUpdateCheck(at: number) {
    this.lastUpdateCheck = at;
    this.save();
  }
  /** The workspace id (not its name) to reopen on launch. */
  setLastWorkspace(id: string | null) {
    this.lastWorkspace = id;
    this.save();
  }
  setFontsDir(dir: string | null) {
    this.fontsDir = dir;
    this.save();
  }
  setLastExportFormat(format: "pdf" | "png" | "svg" | "html") {
    this.lastExportFormat = format;
    this.save();
  }
  setLastPdfStandard(standard: string) {
    this.lastPdfStandard = standard;
    this.save();
  }
  setLastPngScale(scale: number) {
    this.lastPngScale = scale;
    this.save();
  }
  setLastPackageMode(mode: "zip" | "folder") {
    this.lastPackageMode = mode;
    this.save();
  }
}

export const settings = new SettingsStore();
