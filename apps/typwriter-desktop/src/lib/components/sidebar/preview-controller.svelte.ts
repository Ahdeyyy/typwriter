import { untrack } from "svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "svelte-sonner";

import { preview } from "$lib/stores/preview.svelte";
import { platform } from "$lib/stores/platform.svelte";
import { editor } from "$lib/stores/editor.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { jumpFromClick, setVisiblePage, syncPreview, triggerPreview } from "$lib/ipc/commands";
import { emitPreviewSourceJump } from "$lib/ipc/events";
import { logError, logPreview } from "$lib/logger";
import { buildPreviewUrl } from "$lib/preview-url";

export type PreviewControllerOptions = {
  onPresentationMode?: () => void;
};

const DECODE_MAX_ATTEMPTS = 3;
const DECODE_RETRY_BASE_MS = 150;
const STARTUP_RECOVERY_DELAY_MS = 1200;
const STARTUP_RECOVERY_MAX_ATTEMPTS = 4;
const WATCHDOG_INTERVAL_MS = 1500;
const WATCHDOG_RESYNC_AFTER_TICKS = 3;

export class PreviewController {
  // ── Refs / local state ──────────────────────────────────────────────
  scrollEl = $state<HTMLElement | null>(null);
  // visiblePage lives on the shared store (synced across windows) so the
  // popout and the pane line up on the same page after pop-in/pop-out.
  get visiblePage(): number { return preview.visiblePage; }
  set visiblePage(v: number) { preview.visiblePage = v; }
  exportOpen = $state(false);

  // Double-buffered fingerprints — keeps the last good frame visible while
  // the next compile is in flight, avoiding white flashes. The string is a
  // page fingerprint; templates resolve it to a `previewimg://` URL via
  // `buildPreviewUrl` so the webview fetches the PNG directly.
  committedPages = $state<(string | null)[]>([]);
  private pending = new Map<number, string>();
  private decodeAttempts = new Map<number, number>();
  private startupRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private startupRecoveryAttempts = 0;

  // What fingerprint the actual DOM <img> last successfully loaded for each
  // slot. The off-DOM `img.decode()` succeeding doesn't guarantee the DOM
  // element will fetch the same URL — the backend LRU may evict between the
  // two fetches, leaving the skeleton up forever. Templates call
  // `notifyImageLoaded` / `notifyImageError` so the watchdog can recover.
  private renderedFingerprints = new Map<number, string>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private stuckTicks = new Map<number, number>();

  private lastScrollTarget: { page: number; x: number; y: number } | null = null;

  toolbarWidth = $state(0);

  // ── Static / derived ────────────────────────────────────────────────
  readonly isPopout: boolean;
  private onPresentationMode?: () => void;

  zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);
  isNarrow = $derived(this.toolbarWidth > 0 && this.toolbarWidth < 240);

  /** Set by the mounted Preview component so the controller can call back
   *  for presentation mode. Cleared on unmount. */
  setOnPresentationMode(cb: (() => void) | undefined) {
    this.onPresentationMode = cb;
  }

  constructor(opts: PreviewControllerOptions = {}) {
    this.onPresentationMode = opts.onPresentationMode;
    this.isPopout = (() => {
      if (!platform.isDesktop) return false;
      try {
        return getCurrentWindow().label === "preview";
      } catch {
        return false;
      }
    })();

    // On (re)mount, ask the backend to resend its current page set. This is
    // cheap when the pipeline has nothing cached, and recovers stale frames
    // when the mobile preview pane was unmounted and the in-store `pages`
    // buffer is partial or out-of-sync with the decoded `committedPages`.
    syncPreview().mapErr((err) =>
      logError("preview controller: syncPreview on mount failed:", err)
    );
    this.scheduleStartupRecovery();
    this.startWatchdog();
  }

  destroy() {
    if (this.startupRecoveryTimer !== null) {
      clearTimeout(this.startupRecoveryTimer);
      this.startupRecoveryTimer = null;
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.decodeAttempts.clear();
    this.pending.clear();
    this.renderedFingerprints.clear();
    this.stuckTicks.clear();
  }

  /** If the backend never reports any pages but the workspace has a main
   *  file, retry triggerPreview a few times. Covers the race where the
   *  preview pane mounts before the compiler pipeline has been kicked. */
  private scheduleStartupRecovery() {
    if (this.startupRecoveryTimer !== null) return;
    this.startupRecoveryTimer = setTimeout(() => {
      this.startupRecoveryTimer = null;
      if (preview.totalPages > 0) return;
      if (!workspace.mainFile) return;
      if (this.startupRecoveryAttempts >= STARTUP_RECOVERY_MAX_ATTEMPTS) return;
      this.startupRecoveryAttempts += 1;
      triggerPreview("explicit").mapErr((err) =>
        logError("preview controller: startup retry triggerPreview failed:", err)
      );
      this.scheduleStartupRecovery();
    }, STARTUP_RECOVERY_DELAY_MS);
  }

  /** Periodic check that catches pages stuck on the skeleton — usually
   *  because the off-DOM decode succeeded but the DOM `<img>` fetch never
   *  did, or the backend evicted the cached PNG between the two fetches.
   *  Reactive effects only re-run when `preview.pages` changes, so without
   *  this timer a stuck slot would stay stuck until the next compile. */
  private startWatchdog() {
    if (this.watchdogTimer !== null) return;
    this.watchdogTimer = setInterval(() => this.runWatchdogTick(), WATCHDOG_INTERVAL_MS);
  }

  private runWatchdogTick() {
    const pages = preview.pages;
    for (let i = 0; i < pages.length; i++) {
      const fingerprint = pages[i];
      if (!fingerprint) {
        this.stuckTicks.delete(i);
        continue;
      }

      const committed = this.committedPages[i];
      const rendered = this.renderedFingerprints.get(i);
      if (committed === fingerprint && rendered === fingerprint) {
        this.stuckTicks.delete(i);
        continue;
      }
      if (this.pending.get(i) === fingerprint) {
        // A decode is already in flight; give it more time.
        continue;
      }

      const ticks = (this.stuckTicks.get(i) ?? 0) + 1;
      this.stuckTicks.set(i, ticks);

      if (ticks >= WATCHDOG_RESYNC_AFTER_TICKS) {
        // Decode keeps failing — backend may have evicted the cached PNG.
        // Ask it to resend the current set so the fingerprint round-trips.
        this.stuckTicks.set(i, 0);
        syncPreview().mapErr((err) =>
          logError("preview watchdog: syncPreview failed:", err)
        );
      } else {
        // Reset retry budget and try decoding again.
        this.decodeAttempts.delete(i);
        this.attemptDecode(i, fingerprint, 0);
      }
    }
  }

  /** Called from the template when the DOM `<img>` finishes loading. */
  notifyImageLoaded(i: number, fingerprint: string) {
    this.renderedFingerprints.set(i, fingerprint);
    this.stuckTicks.delete(i);
  }

  /** Called from the template when the DOM `<img>` fails to load. Clears
   *  the committed slot so the skeleton reappears and re-attempts the
   *  decode that gates it. */
  notifyImageError(i: number, fingerprint: string) {
    this.renderedFingerprints.delete(i);
    if (this.committedPages[i] === fingerprint) this.committedPages[i] = null;
    this.pending.delete(i);
    this.decodeAttempts.delete(i);
    if (preview.pages[i] === fingerprint) this.attemptDecode(i, fingerprint, 0);
  }

  // ── Effects, exposed as methods consumers wire via $effect ──────────

  /** Sync committed page buffer with `preview.pages` and decode incoming data. */
  syncPagesEffect() {
    const incoming = preview.pages;

    const curLen = untrack(() => this.committedPages.length);
    // Stage 4a: reconcile the committed (on-screen) buffer length with the
    // incoming page set. A length change here is what actually adds/removes
    // DOM page slots in scroll view, reflowing the container.
    if (curLen !== incoming.length) {
      logPreview("buffer:resize", {
        from: curLen,
        to: incoming.length,
        paginated: preview.paginated,
      });
    }
    if (curLen < incoming.length) {
      for (let i = curLen; i < incoming.length; i++) this.committedPages.push(null);
    } else if (curLen > incoming.length) {
      this.committedPages.splice(incoming.length);
      for (const key of [...this.decodeAttempts.keys()]) {
        if (key >= incoming.length) this.decodeAttempts.delete(key);
      }
    }

    for (let i = 0; i < incoming.length; i++) {
      const fingerprint = incoming[i];
      if (!fingerprint) continue;
      if (fingerprint === untrack(() => this.committedPages[i])) continue;
      if (this.pending.get(i) === fingerprint) continue;

      this.decodeAttempts.delete(i);
      this.attemptDecode(i, fingerprint, 0);
    }
  }

  private attemptDecode(idx: number, fingerprint: string, attempt: number) {
    this.pending.set(idx, fingerprint);
    this.decodeAttempts.set(idx, attempt);

    const img = new Image();
    img.src = buildPreviewUrl(fingerprint);
    img
      .decode()
      .then(() => {
        if (this.pending.get(idx) !== fingerprint) return;
        this.pending.delete(idx);
        this.decodeAttempts.delete(idx);
        if (preview.pages[idx] === fingerprint) {
          // Stage 4b: decode succeeded and we commit the slot. If this slot was
          // showing the fixed-size skeleton placeholder, swapping in the real
          // image changes its height — shifting everything below it.
          const wasSkeleton = this.committedPages[idx] == null;
          logPreview("decode:commit", { idx, wasSkeleton, attempt });
          this.committedPages[idx] = fingerprint;
        }
      })
      .catch((err) => {
        if (this.pending.get(idx) !== fingerprint) return;
        const next = attempt + 1;
        if (next < DECODE_MAX_ATTEMPTS) {
          const delay = DECODE_RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`preview: decode page ${idx} failed (attempt ${attempt + 1}), retrying in ${delay}ms`, err);
          setTimeout(() => {
            if (preview.pages[idx] !== fingerprint) {
              this.pending.delete(idx);
              return;
            }
            this.attemptDecode(idx, fingerprint, next);
          }, delay);
          return;
        }
        this.pending.delete(idx);
        this.decodeAttempts.delete(idx);
        console.warn(`preview: gave up decoding page ${idx} after ${DECODE_MAX_ATTEMPTS} attempts`, err);
        // Last resort: ask the backend to re-emit pages. A miss here usually
        // means the fingerprint was evicted from the LRU before the webview
        // got to fetch it — `syncPreview` re-publishes the latest known set.
        syncPreview().mapErr((e) =>
          logError("preview: syncPreview after decode failure failed:", e)
        );
      });
  }

  /** Scroll to cursor-sync target when it changes. */
  scrollTargetEffect() {
    const target = preview.scrollTarget;
    if (target === null) return;
    preview.scrollTarget = null;
    this.lastScrollTarget = target;
    // Stage 5: a scroll target was published (by cursor-sync or a preview
    // click) and the effect re-ran to consume it.
    logPreview("scroll:effect-fired", { page: target.page, x: target.x, y: target.y });
    this._applyScrollTarget(target);
  }

  private _applyScrollTarget(target: { page: number; x: number; y: number }) {
    const prevVisible = this.visiblePage;
    this.visiblePage = target.page;
    if (preview.paginated) {
      // Paginated view: no scroll, just flips which single page renders.
      logPreview("scroll:apply:paginated", {
        page: target.page,
        prevVisible,
        pageChanged: prevVisible !== target.page,
      });
      setVisiblePage(target.page);
      return;
    }

    requestAnimationFrame(() => {
      const pageEl = document.getElementById(`preview-page-${target.page}`);
      if (!pageEl || !this.scrollEl) {
        logPreview("scroll:apply:abort", {
          reason: !pageEl ? "no-page-el" : "no-scroll-el",
          page: target.page,
        });
        return;
      }

      const yPx = target.y * preview.zoom;
      const yAbs = pageEl.offsetTop + yPx;

      // Skip the scroll if the target is already comfortably on screen —
      // user probably just clicked there.
      const viewTop = this.scrollEl.scrollTop;
      const viewBottom = viewTop + this.scrollEl.clientHeight;
      const margin = 24;
      if (yAbs >= viewTop + margin && yAbs <= viewBottom - margin) {
        // This is the "doesn't jump" branch: target already visible, so we
        // leave the scroll position alone.
        logPreview("scroll:apply:skip-onscreen", {
          page: target.page,
          yAbs: Math.round(yAbs),
          viewTop: Math.round(viewTop),
          viewBottom: Math.round(viewBottom),
        });
        return;
      }

      const scrollTo = yAbs - this.scrollEl.clientHeight / 3;
      // This is the "jumps" branch: target is off-screen, so we smooth-scroll
      // the preview. `offsetTop`/`zoom`/`y` here show exactly where it lands.
      logPreview("scroll:apply:scroll-to", {
        page: target.page,
        from: Math.round(viewTop),
        to: Math.round(scrollTo),
        delta: Math.round(scrollTo - viewTop),
        offsetTop: Math.round(pageEl.offsetTop),
        yPx: Math.round(yPx),
        zoom: preview.zoom,
      });
      this.scrollEl.scrollTo({ top: scrollTo, behavior: "smooth" });
    });
  }

  /** Re-apply the last cursor-sync scroll — call when the preview becomes
   *  visible after being hidden so the position is restored. */
  reapplyLastScroll() {
    if (this.lastScrollTarget === null) return;
    this._applyScrollTarget(this.lastScrollTarget);
  }

  /** Scroll the (possibly freshly remounted) scroll container to the page
   *  recorded in the shared `visiblePage`. Called by the Preview component
   *  on mount so popping the preview out and back in lands on the same page
   *  instead of jumping to page 0. */
  restoreScrollToVisiblePage() {
    const idx = this.visiblePage;
    if (idx <= 0) return;
    if (preview.paginated) {
      setVisiblePage(idx);
      return;
    }
    requestAnimationFrame(() => {
      const pageEl = document.getElementById(`preview-page-${idx}`);
      if (!pageEl || !this.scrollEl) return;
      // Stage 8: on (re)mount, snap the fresh scroll container to the last
      // visible page. Fires when the pane remounts (popout in/out, view
      // toggle) — a jump here is mount-related, not editing-related.
      logPreview("scroll:restore-to-visible", {
        idx,
        offsetTop: Math.round(pageEl.offsetTop),
      });
      this.scrollEl.scrollTo({ top: pageEl.offsetTop, behavior: "instant" as ScrollBehavior });
    });
  }

  /** Track which page is visible via IntersectionObserver (scroll-view only). */
  pageCounterEffect(): (() => void) | void {
    const el = this.scrollEl;
    const count = preview.totalPages;
    if (!el || count === 0 || preview.paginated) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.id.replace("preview-page-", ""), 10);
            if (!isNaN(idx)) {
              // Stage 6: scroll-driven page-number generation. The visible page
              // (and the "N / total" label) is derived here from whichever page
              // crosses the 50% threshold. A reflow that nudges pages past the
              // threshold makes this fire and bumps the number — even without
              // the user scrolling.
              if (this.visiblePage !== idx) {
                logPreview("page-counter:visible-changed", {
                  from: this.visiblePage,
                  to: idx,
                  ratio: Number(entry.intersectionRatio.toFixed(2)),
                });
              }
              this.visiblePage = idx;
              setVisiblePage(idx);
            }
          }
        }
      },
      { root: el, threshold: 0.5 }
    );

    for (let i = 0; i < count; i++) {
      const pageEl = document.getElementById(`preview-page-${i}`);
      if (pageEl) observer.observe(pageEl);
    }

    return () => observer.disconnect();
  }

  /** Keep visiblePage in bounds when totalPages shrinks. */
  clampVisiblePageEffect() {
    const total = preview.totalPages;
    if (total === 0) return;
    if (this.visiblePage >= total) {
      // Stage 7: page count shrank below the current page number. Clamping it
      // back into range jumps the reported page (and, in paginated view, the
      // rendered page) downward.
      logPreview("clamp:visible-page", {
        from: this.visiblePage,
        to: total - 1,
        total,
      });
      this.visiblePage = total - 1;
    }
  }

  // ── Toolbar actions ─────────────────────────────────────────────────
  zoomIn() {
    preview.zoomIn().catch((err) => logError("preview zoom in failed:", err));
  }

  zoomOut() {
    preview.zoomOut().catch((err) => logError("preview zoom out failed:", err));
  }

  refresh() {
    // Reset retry budgets so a manual refresh fully re-attempts decode.
    this.decodeAttempts.clear();
    this.pending.clear();
    this.stuckTicks.clear();
    this.renderedFingerprints.clear();
    this.startupRecoveryAttempts = 0;
    syncPreview().mapErr((err) =>
      logError("preview controller: syncPreview before refresh failed:", err)
    );
    preview.triggerRefresh().catch((err) => logError("preview refresh failed:", err));
  }

  togglePaginated() {
    preview.togglePaginated();
  }

  goToPage(idx: number) {
    if (preview.totalPages === 0) return;
    const clamped = Math.max(0, Math.min(preview.totalPages - 1, idx));
    // Stage 9: explicit user navigation (toolbar arrows / keyboard). Lets you
    // rule out user action when reading why the page number moved.
    logPreview("nav:go-to-page", { requested: idx, clamped, from: this.visiblePage });
    this.visiblePage = clamped;
    setVisiblePage(clamped);
  }

  nextPage() {
    this.goToPage(this.visiblePage + 1);
  }

  prevPage() {
    this.goToPage(this.visiblePage - 1);
  }

  openExport() {
    this.exportOpen = true;
  }

  togglePresentation() {
    if (!this.isPopout) {
      this.onPresentationMode?.();
      return;
    }
    const entering = !preview.presentationMode;
    preview
      .togglePresentationMode()
      .then(() => {
        if (entering) toast.info("Press Esc to exit presenter mode");
      })
      .catch((err) => logError("preview presentation mode failed:", err));
  }

  /** Keyboard navigation for paginated view. */
  handleKeydown(e: KeyboardEvent) {
    if (!preview.paginated) return;
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
    }
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
      e.preventDefault();
      this.nextPage();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      this.prevPage();
    } else if (e.key === "Home") {
      e.preventDefault();
      this.goToPage(0);
    } else if (e.key === "End") {
      e.preventDefault();
      this.goToPage(preview.totalPages - 1);
    }
  }

  // ── Page click → source jump ────────────────────────────────────────
  /** Reset transient buffers without tearing down the singleton. Called
   *  when the preview component unmounts (popout opening, workspace pane
   *  hidden) so DOM-bound refs don't dangle, but the decoded page buffer
   *  and visiblePage stay intact so the next mount paints instantly
   *  instead of re-decoding from scratch. */
  detachFromMount() {
    this.scrollEl = null;
    this.toolbarWidth = 0;
    this.onPresentationMode = undefined;
  }

  async handlePageClick(e: MouseEvent, pageIndex: number) {
    const img = e.target as HTMLImageElement;
    const px = (e.offsetX / img.clientWidth) * img.naturalWidth;
    const py = (e.offsetY / img.clientHeight) * img.naturalHeight;

    const result = await jumpFromClick(pageIndex, px, py);
    if (result.isErr() || !result.value) return;

    const jump = result.value;
    if (jump.type === "file") {
      if (this.isPopout) {
        emitPreviewSourceJump({ path: jump.path, offset: jump.start_byte }).mapErr(
          (err) => logError("emit preview:source-jump failed:", err)
        );
        return;
      }
      if (!workspace.rootPath) return;
      const relPath = workspace.toRel(jump.path);
      editor
        .openFile(relPath)
        .map(() => editor.requestCursorJump(relPath, jump.start_byte))
        .mapErr((err) => logError("jump from click failed:", err));
    } else if (jump.type === "url") {
      openUrl(jump.url).catch((err) => logError("open url failed:", err));
    } else if (jump.type === "position") {
      preview.scrollTarget = { page: jump.page, x: jump.x, y: jump.y };
    }
  }
}

// Per-webview singleton. The Preview component used to `new PreviewController`
// inside its <script>, which meant unmounting the pane (e.g. when the user
// pops the preview out into a separate window) destroyed every per-controller
// buffer — decoded page fingerprints, visible-page index, watchdog state. On
// remount everything re-decoded from scratch and the pane looked like it
// "reloaded". Hoisting to a singleton lets state survive across mounts;
// `detachFromMount()` clears the DOM-bound refs without nuking the buffers.
//
// One instance per webview is fine — popout windows have their own module
// graph, so each window gets its own singleton with its own DOM-bound state,
// while shared state (zoom, paginated, scroll target, visible page) flows
// through `crossWindowState` on the preview store.
export const previewController = new PreviewController();
