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

/** Retries for a measurement that isn't available yet (cold start). */
const RETRY_MS = [150, 400, 1000, 2500];
/** Status bar height to assume if the plugin never answers (Android's
 *  standard is 24dp; cutout phones run taller). */
const FALLBACK_STATUS_BAR_PX = 24;

/** An Android phone always has a status or navigation bar; all zeros means
 *  the window hadn't laid out its insets yet, not that there are none. */
function measured(insets: SystemInsets | null | undefined): insets is SystemInsets {
  return !!insets && SIDES.some((side) => (insets[side] ?? 0) > 0);
}

function applyInsets(insets: SystemInsets) {
  const root = document.documentElement.style;
  for (const side of SIDES) {
    const px = Math.max(0, Math.round(insets[side] ?? 0));
    root.setProperty(`--safe-${side}`, `max(env(safe-area-inset-${side}, 0px), ${px}px)`);
  }
}

class SystemBarsStore {
  private cleanup: (() => void) | null = null;

  /** Apply cached insets immediately — call as early as possible. Returns
   *  whether there were any. */
  restore(): boolean {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      const insets = cached ? (JSON.parse(cached) as SystemInsets) : null;
      if (measured(insets)) {
        applyInsets(insets);
        return true;
      }
      // An earlier build could cache zeros measured too early.
      if (cached) localStorage.removeItem(CACHE_KEY);
    } catch {
      // No storage or a corrupt entry: the env() defaults hold until measured.
    }
    return false;
  }

  init() {
    if (this.cleanup || typeof window === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let applied = this.restore();
    /** Measure; on failure, keep the current values and retry `attempt`. */
    const measure = (attempt = 0) => {
      void getSystemInsets().match(
        (insets) => {
          if (stopped) return;
          if (measured(insets)) {
            applied = true;
            applyInsets(insets);
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify(insets));
            } catch {
              // Best effort.
            }
          } else {
            retry(attempt);
          }
        },
        () => retry(attempt),
      );
    };
    const retry = (attempt: number) => {
      if (stopped) return;
      if (attempt >= RETRY_MS.length) {
        // Never measured: on Android a typical status bar beats drawing the
        // header under the clock. Not cached — the next start measures again.
        if (!applied && /Android/i.test(navigator.userAgent)) {
          applyInsets({ top: FALLBACK_STATUS_BAR_PX, bottom: 0, left: 0, right: 0 });
        }
        return;
      }
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => measure(attempt + 1), RETRY_MS[attempt]);
    };
    const onResize = () => {
      measure();
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => measure(), REMEASURE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") measure();
    };
    measure();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    const stopEffects = $effect.root(() => {
      $effect(() => {
        void setStatusBarHidden(immersive.statusBarHidden);
      });
      $effect(() => {
        void setSystemBarStyle(mode.current === "dark");
      });
    });

    this.cleanup = () => {
      stopped = true;
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) clearTimeout(timer);
      if (retryTimer !== null) clearTimeout(retryTimer);
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
