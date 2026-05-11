import { untrack } from "svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "svelte-sonner";

import { preview } from "$lib/stores/preview.svelte";
import { editor } from "$lib/stores/editor.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { jumpFromClick, setVisiblePage } from "$lib/ipc/commands";
import { emitPreviewSourceJump } from "$lib/ipc/events";
import { logError } from "$lib/logger";

export type PreviewControllerOptions = {
  onPresentationMode?: () => void;
};

export class PreviewController {
  // ── Refs / local state ──────────────────────────────────────────────
  scrollEl = $state<HTMLElement | null>(null);
  visiblePage = $state(0);
  exportOpen = $state(false);

  // Double-buffered decoded page data — keeps last good frame visible
  // while the next compile is in flight, avoiding white flashes.
  committedPages = $state<(string | null)[]>([]);
  private pending = new Map<number, string>();

  toolbarWidth = $state(0);

  // ── Static / derived ────────────────────────────────────────────────
  readonly isPopout: boolean;
  private onPresentationMode?: () => void;

  zoomLabel = $derived(`${Math.round(preview.zoom * 50)}%`);
  isNarrow = $derived(this.toolbarWidth > 0 && this.toolbarWidth < 240);

  constructor(opts: PreviewControllerOptions = {}) {
    this.onPresentationMode = opts.onPresentationMode;
    this.isPopout = (() => {
      try {
        return getCurrentWindow().label === "preview";
      } catch {
        return false;
      }
    })();
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
    }

    for (let i = 0; i < incoming.length; i++) {
      const data = incoming[i];
      if (!data) continue;
      if (data === untrack(() => this.committedPages[i])) continue;
      if (this.pending.get(i) === data) continue;

      const idx = i;
      this.pending.set(idx, data);

      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      img.decode()
        .then(() => {
          if (this.pending.get(idx) === data) this.pending.delete(idx);
          if (preview.pages[idx] === data) this.committedPages[idx] = data;
        })
        .catch(() => {
          if (this.pending.get(idx) === data) this.pending.delete(idx);
          console.warn(`preview: failed to decode page ${idx}`);
        });
    }
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
