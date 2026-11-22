// Android system bars for the edge-to-edge shell.
//
// 1. Insets. The app draws behind the status and navigation bars, so the UI
//    has to know how tall they are — and `env(safe-area-inset-*)` reads 0 in
//    many Android WebViews. The `system-bars` plugin reports the real values;
//    they are published as `--safe-top` / `--safe-bottom` / `--safe-left` /
//    `--safe-right` on <html>, taking the larger of the plugin's number and
//    `env()` so a WebView that does report them still wins. `layout.css`
//    defaults the vars to `env()` for the first frame and the desktop window.
//    The last values are cached so a cold start paints at the right offsets.
// 2. Status bar visibility, from `immersive.statusBarHidden`.
// 3. Bar icon colour, from the app's own theme rather than the system's.

import { mode } from "mode-watcher";
import { getSystemInsets, setStatusBarHidden, setSystemBarStyle } from "$lib/ipc/commands";
import type { SystemInsets } from "$lib/ipc/types";
import { immersive } from "./immersive.svelte";

const CACHE_KEY = "typwriter.system-insets";
const SIDES = ["top", "bottom", "left", "right"] as const;
/** Insets settle a beat after a rotation; measure again once they have. */
const REMEASURE_MS = 350;

function applyInsets(insets: SystemInsets) {
  const root = document.documentElement.style;
  for (const side of SIDES) {
    const px = Math.max(0, Math.round(insets[side] ?? 0));
    root.setProperty(`--safe-${side}`, `max(env(safe-area-inset-${side}, 0px), ${px}px)`);
  }
}

class SystemBarsStore {
  private cleanup: (() => void) | null = null;

  /** Apply cached insets immediately — call as early as possible. */
  restore() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) applyInsets(JSON.parse(cached) as SystemInsets);
    } catch {
      // No storage or a corrupt entry: the env() defaults hold until measured.
    }
  }

  init() {
    if (this.cleanup || typeof window === "undefined") return;
    this.restore();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      void getSystemInsets().map((insets) => {
        applyInsets(insets);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(insets));
        } catch {
          // Best effort.
        }
      });
    };
    const onResize = () => {
      measure();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(measure, REMEASURE_MS);
    };
    measure();
    window.addEventListener("resize", onResize);

    const stopEffects = $effect.root(() => {
      $effect(() => {
        void setStatusBarHidden(immersive.statusBarHidden);
      });
      $effect(() => {
        void setSystemBarStyle(mode.current === "dark");
      });
    });

    this.cleanup = () => {
      window.removeEventListener("resize", onResize);
      if (timer !== null) clearTimeout(timer);
      stopEffects();
      void setStatusBarHidden(false);
    };
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

export const systemBars = new SystemBarsStore();
