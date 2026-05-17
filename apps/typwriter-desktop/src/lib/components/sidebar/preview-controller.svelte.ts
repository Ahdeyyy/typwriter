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
import { logError } from "$lib/logger";
import { buildPreviewUrl } from "$lib/preview-url";

export type PreviewControllerOptions = {
  onPresentationMode?: () => void;
};

const DECODE_MAX_ATTEMPTS = 3;
const DECODE_RETRY_BASE_MS = 150;
const STARTUP_RECOVERY_DELAY_MS = 1200;
const STARTUP_RECOVERY_MAX_ATTEMPTS = 4;

export class PreviewController {
  // ── Refs / local state ──────────────────────────────────────────────
  scrollEl = $state<HTMLElement | null>(null);
  visiblePage = $state(0);
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

  toolbarWidth = $state(0);

  // ── Static / derived ────────────────────────────────────────────────
  readonly isPopout: boolean;
  private onPresentationMode?: () => void;

  zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);
  isNarrow = $derived(this.toolbarWidth > 0 && this.toolbarWidth < 240);

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
  }

  destroy() {
    if (this.startupRecoveryTimer !== null) {
      clearTimeout(this.startupRecoveryTimer);
      this.startupRecoveryTimer = null;
    }
    this.decodeAttempts.clear();
    this.pending.clear();
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

  // ── Effects, exposed as methods consumers wire via $effect ──────────

  /** Sync committed page buffer with `preview.pages` and decode incoming data. */
  syncPagesEffect() {
    const incoming = preview.pages;

    const curLen = untrack(() => this.committedPages.length);
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
        if (preview.pages[idx] === fingerprint) this.committedPages[idx] = fingerprint;
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

    this.visiblePage = target.page;
    if (preview.paginated) {
      setVisiblePage(target.page);
      return;
    }

    requestAnimationFrame(() => {
      const pageEl = document.getElementById(`preview-page-${target.page}`);
      if (!pageEl || !this.scrollEl) return;

      const yPx = target.y * preview.zoom;
      const yAbs = pageEl.offsetTop + yPx;

      // Skip the scroll if the target is already comfortably on screen —
      // user probably just clicked there.
      const viewTop = this.scrollEl.scrollTop;
      const viewBottom = viewTop + this.scrollEl.clientHeight;
      const margin = 24;
      if (yAbs >= viewTop + margin && yAbs <= viewBottom - margin) return;

      const scrollTo = yAbs - this.scrollEl.clientHeight / 3;
      this.scrollEl.scrollTo({ top: scrollTo, behavior: "smooth" });
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
    if (this.visiblePage >= total) this.visiblePage = total - 1;
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
