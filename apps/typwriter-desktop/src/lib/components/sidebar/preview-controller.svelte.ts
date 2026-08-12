import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "svelte-sonner";

import { preview } from "$lib/stores/preview.svelte";
import { editor } from "$lib/stores/editor.svelte";
import { workspace } from "$lib/stores/workspace.svelte";
import { jumpFromClick, setVisiblePage, syncPreview, triggerPreview } from "$lib/ipc/commands";
import { emitPreviewSourceJump } from "$lib/ipc/events";
import { matchesCommand } from "$lib/keybindings";
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

// A decoded page costs `width * height * 4` bytes of bitmap however small its
// PNG is (~6 MB for a 16:9 slide at zoom 2), so a document of a few hundred
// pages cannot hold them all at once. Only pages near the viewport are decoded;
// the retain window is wider so ordinary scrolling doesn't thrash
// decode → evict → decode. `2 * DECODE_WINDOW + 1` pages are resident at a
// time — that product is the memory budget.
const DECODE_WINDOW = 24;
const RETAIN_WINDOW = 80;

// Share of the decode window placed ahead of the direction of travel; the rest
// trails behind. Only the decode window leans — a leaning retain window would
// evict the pages a reversing reader is about to reach.
const DECODE_AHEAD_SHARE = 0.75;

// Page images are `loading="lazy"`, so an off-screen one legitimately never
// fetches and never fires `onload`. The watchdog may only judge pages close
// enough that the browser's lazy margin has certainly been crossed.
const WATCHDOG_WINDOW = 2;

// Fallback box for a page that has never been decoded and has no decoded
// sibling to borrow dimensions from.
const DEFAULT_PAGE_DIMS = { w: 566, h: 800 };

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

  // Natural pixel dimensions per fingerprint, captured from the off-DOM
  // decode. Templates stamp these as width/height attributes on the page
  // <img>s so the browser reserves the correct box before the image loads —
  // without them a freshly remounted pane's images are all ~0px tall, so any
  // scroll restore measures garbage offsets and lands at the top while the
  // loading images push the real target further down.
  pageDims = new SvelteMap<string, { w: number; h: number }>();

  // Natural size of the most recently decoded page. Pages outside the decode
  // window have no image to measure, so their skeletons borrow this to reserve
  // the box the image would occupy — which is what keeps `offsetTop` (and so
  // the scroll position) stable as pages decode and are released. Sound because
  // a document's pages normally all share one size.
  lastDims = $state<{ w: number; h: number } | null>(null);

  /** Direction of travel: +1 toward later pages, -1 toward earlier. Reactive so
   *  a reversal re-runs `syncPagesEffect` and swings the lookahead round. */
  scrollDir = $state<1 | -1>(1);

  /** Whether any page has decoded yet, i.e. whether skeletons can reserve a
   *  realistic box and the scroll layout is worth measuring. */
  get pageMetricsKnown(): boolean {
    return this.lastDims !== null;
  }

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
  // Watchdog `syncPreview` attempts per fingerprint. A fingerprint that is
  // permanently gone (evicted from the LRU *and* the disk cache) would
  // otherwise loop decode-fail → resync forever.
  private resyncCounts = new Map<string, number>();
  private static readonly MAX_RESYNCS_PER_FINGERPRINT = 3;

  private lastScrollTarget: { page: number; x: number; y: number } | null = null;

  // A restore of `visiblePage` is owed to a freshly (re)mounted scroll
  // container. While set, the scroll-driven page counter must not write
  // `visiblePage`: a fresh container sits at scrollTop=0, so its seed
  // recompute would stamp page 0 over the shared cross-window value before
  // `restoreScrollToVisiblePage` ever runs — losing the page whenever the
  // preview is popped out or back in. Cleared once the restore is applied
  // or explicit navigation supersedes it.
  restorePending = $state(true);

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
      try {
        return getCurrentWindow().label === "preview";
      } catch {
        return false;
      }
    })();

    // On (re)mount, ask the backend to resend its current page set. This is
    // cheap when the pipeline has nothing cached, and recovers stale frames
    // when the preview pane was unmounted and the in-store `pages` buffer is
    // partial or out-of-sync with the decoded `committedPages`.
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
    this.resyncCounts.clear();
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

      // Paginated / presentation view mounts an <img> only for the visible
      // page; every other slot decodes fine but never fires `onload`, so its
      // `renderedFingerprints` entry stays unset. Treating those as stuck
      // would resync forever.
      if ((preview.paginated || preview.presentationMode) && i !== preview.visiblePage) {
        this.stuckTicks.delete(i);
        continue;
      }

      // Away from the viewport a slot is expected to lack a decoded image
      // (outside the decode window) or a loaded one (lazy `<img>`), so neither
      // is evidence of a fault. Such pages recover when scrolled to, which is
      // the only time being stuck would show.
      if (!this.inWindow(i, WATCHDOG_WINDOW)) {
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
        const n = (this.resyncCounts.get(fingerprint) ?? 0) + 1;
        this.resyncCounts.set(fingerprint, n);
        if (n > PreviewController.MAX_RESYNCS_PER_FINGERPRINT) continue;
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

  /** Natural dimensions for a committed fingerprint, if its decode
   *  recorded them. Reactive via SvelteMap. */
  dimsFor(fingerprint: string | null | undefined): { w: number; h: number } | undefined {
    return fingerprint ? this.pageDims.get(fingerprint) : undefined;
  }

  /** Box to reserve for page `i` while it has no decoded image. Templates must
   *  lay the skeleton out exactly like the `<img>` (width + aspect-ratio,
   *  `max-w-full`, `h-auto`) so swapping between them never changes the page's
   *  height. */
  skeletonDims(i: number): { w: number; h: number } {
    return this.dimsFor(preview.pages[i]) ?? this.lastDims ?? DEFAULT_PAGE_DIMS;
  }

  /** Whether page `i` is within `span` pages of the one on screen. Documents
   *  short enough to fit entirely inside the span are always in window, so
   *  windowing is invisible for anything but long documents. */
  private inWindow(i: number, span: number): boolean {
    if (preview.pages.length <= 2 * span + 1) return true;
    return Math.abs(i - preview.visiblePage) <= span;
  }

  /** Whether page `i` should hold a decoded image. */
  private inDecodeWindow(i: number): boolean {
    if (preview.pages.length <= 2 * DECODE_WINDOW + 1) return true;
    const { lo, hi } = this.decodeBounds();
    return i >= lo && i <= hi;
  }

  /** Inclusive page range the decode window covers, leaning `DECODE_AHEAD_SHARE`
   *  toward `scrollDir`. Held at constant width: where the lean overhangs an end
   *  of the document the excess moves to the other side rather than being
   *  dropped, so the resident page count (the memory budget) doesn't vary. */
  private decodeBounds(): { lo: number; hi: number } {
    const last = preview.pages.length - 1;
    const total = 2 * DECODE_WINDOW;
    const ahead = Math.round(total * DECODE_AHEAD_SHARE);
    const behind = total - ahead;
    const v = preview.visiblePage;

    let lo = v - (this.scrollDir >= 0 ? behind : ahead);
    let hi = v + (this.scrollDir >= 0 ? ahead : behind);
    if (lo < 0) {
      hi += -lo;
      lo = 0;
    }
    if (hi > last) {
      lo -= hi - last;
      hi = last;
    }
    return { lo: Math.max(0, lo), hi };
  }

  /** Drop a page's decoded image so the webview can release its bitmap. The
   *  slot falls back to a skeleton of the same size, so nothing moves. */
  private releaseSlot(i: number) {
    if (untrack(() => this.committedPages[i]) != null) this.committedPages[i] = null;
    this.pending.delete(i);
    this.decodeAttempts.delete(i);
    this.renderedFingerprints.delete(i);
    this.stuckTicks.delete(i);
  }

  /** Called from the template when the DOM `<img>` finishes loading. */
  notifyImageLoaded(i: number, fingerprint: string) {
    this.renderedFingerprints.set(i, fingerprint);
    this.stuckTicks.delete(i);
    this.resyncCounts.delete(fingerprint);
  }

  /** Called from the template when the DOM `<img>` fails to load. Clears
   *  the committed slot so the skeleton reappears and re-attempts the
   *  decode that gates it. */
  notifyImageError(i: number, fingerprint: string) {
    this.renderedFingerprints.delete(i);
    if (this.committedPages[i] === fingerprint) this.committedPages[i] = null;
    this.pending.delete(i);
    this.decodeAttempts.delete(i);
    if (preview.pages[i] === fingerprint && this.inDecodeWindow(i)) {
      this.attemptDecode(i, fingerprint, 0);
    }
  }

  // ── Effects, exposed as methods consumers wire via $effect ──────────

  /** Sync committed page buffer with `preview.pages` and decode incoming data. */
  syncPagesEffect() {
    const incoming = preview.pages;
    // Read unconditionally so scrolling re-runs the effect and slides the
    // windows along; the checks below only read it for long documents.
    void preview.visiblePage;

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
      if (!this.inWindow(i, RETAIN_WINDOW)) {
        this.releaseSlot(i);
        continue;
      }
      // In the retain band but not the decode band: keep an image that is still
      // current so short scrolls don't flash a skeleton, but drop one a
      // recompile has superseded rather than show stale content off screen.
      if (!this.inDecodeWindow(i)) {
        if (untrack(() => this.committedPages[i]) !== fingerprint) this.releaseSlot(i);
        continue;
      }
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
        // Dimensions are keyed by fingerprint, so they're valid to record
        // even if this decode lost the race for the slot.
        const dims = { w: img.naturalWidth, h: img.naturalHeight };
        this.pageDims.set(fingerprint, dims);
        this.lastDims = dims;
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
    // A cursor-sync jump is fresher than any owed mount restore.
    this.restorePending = false;
    const prevVisible = this.visiblePage;
    if (target.page !== prevVisible) {
      this.scrollDir = target.page > prevVisible ? 1 : -1;
    }
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

      // Convert the in-page y (typst points) to on-screen pixels. The backend
      // renders 1pt → `zoom` natural px, but the <img> is `max-w-full`, so it's
      // CSS-scaled to the pane width whenever that's narrower than the natural
      // image — meaning its on-screen scale is *not* `zoom`. Derive the true
      // scale from the rendered image (`clientHeight / naturalHeight`) so the
      // landing y is right regardless of zoom or pane width; fall back to the
      // raw `zoom` only while the page is still a fixed-size skeleton.
      const img = pageEl.querySelector("img");
      const naturalPx = target.y * preview.zoom;
      const yPx =
        img && img.naturalHeight > 0
          ? naturalPx * (img.clientHeight / img.naturalHeight)
          : naturalPx;
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
   *  while `restorePending` so popping the preview out and back in lands on
   *  the same page instead of jumping to page 0. Leaves `restorePending`
   *  set when the target page hasn't rendered yet, so the mount effect
   *  retries as pages stream in. */
  restoreScrollToVisiblePage() {
    const idx = this.visiblePage;
    if (idx <= 0) {
      // Already at the first page — nothing to scroll, restore is done.
      this.restorePending = false;
      return;
    }
    if (preview.paginated) {
      // Paginated view renders `visiblePage` directly; just tell the backend.
      setVisiblePage(idx);
      this.restorePending = false;
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
      this.restorePending = false;
    });
  }

  /** Track which page is visible by scroll position (scroll-view only).
   *
   *  We deliberately do NOT use an IntersectionObserver with a fixed ratio
   *  threshold here. In the popped-out window the pages are scaled up to the
   *  (wide) window width via `max-w-full`, which makes a single page taller
   *  than the viewport. A page taller than ~2× the viewport can never reach a
   *  0.5 visible ratio, so a threshold observer would simply never fire and the
   *  page counter would freeze on scroll. Computing the visible page from the
   *  scroll position instead works for pages of any height. */
  pageCounterEffect(): (() => void) | void {
    const el = this.scrollEl;
    const count = preview.totalPages;
    if (!el || count === 0 || preview.paginated) return;

    let rafId = 0;

    const recompute = () => {
      rafId = 0;
      // A restore is still owed to this freshly mounted container, which is
      // sitting at scrollTop=0. Writing here would broadcast page 0 over the
      // shared cross-window `visiblePage` before the restore reads it. The
      // mount effect seeds `recompute()` synchronously, so this read also
      // makes the effect re-seed the counter once the restore completes.
      if (this.restorePending) return;
      // Reference line a third of the way down the viewport. The visible page
      // is the last one whose top edge sits at or above this line — i.e. the
      // page currently occupying the upper portion of the view.
      const referenceY = el.getBoundingClientRect().top + el.clientHeight / 3;
      // Bisect rather than walk: page elements are in document order, so their
      // top edges are monotonic. A linear walk would measure every page above
      // the viewport — hundreds of forced layouts per scroll frame in a long
      // document.
      let lo = 0;
      let hi = count - 1;
      let idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const pageEl = document.getElementById(`preview-page-${mid}`);
        if (!pageEl) break;
        if (pageEl.getBoundingClientRect().top <= referenceY) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      // Stage 6: scroll-driven page-number generation. The visible page (and the
      // "N / total" label) is derived from whichever page straddles the
      // reference line. A reflow that nudges pages can also change this — even
      // without the user scrolling.
      if (this.visiblePage !== idx) {
        logPreview("page-counter:visible-changed", { from: this.visiblePage, to: idx });
        this.visiblePage = idx;
        setVisiblePage(idx);
      }
    };

    // Direction comes from the scroll offset rather than from `visiblePage` so a
    // reversal registers immediately instead of only once the reader crosses
    // back over a page boundary. The threshold stops jitter flapping it;
    // assigning an unchanged primitive is a no-op for `$state`, so
    // `syncPagesEffect` is only invalidated on a real reversal.
    let lastTop = el.scrollTop;
    const DIR_FLIP_THRESHOLD_PX = 4;

    const onScroll = () => {
      const top = el.scrollTop;
      if (Math.abs(top - lastTop) > DIR_FLIP_THRESHOLD_PX) {
        this.scrollDir = top > lastTop ? 1 : -1;
        lastTop = top;
      }
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(recompute);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    // Seed the counter for the current position (e.g. after a remount snap).
    recompute();

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
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
    this.resyncCounts.clear();
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
    this.restorePending = false;
    // Paginated view has no scroll container to take a direction from, so
    // explicit paging is the only signal for which way to lean.
    if (clamped !== this.visiblePage) {
      this.scrollDir = clamped > this.visiblePage ? 1 : -1;
    }
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
    if (matchesCommand(e, "preview.nextPage")) {
      e.preventDefault();
      this.nextPage();
    } else if (matchesCommand(e, "preview.previousPage")) {
      e.preventDefault();
      this.prevPage();
    } else if (matchesCommand(e, "preview.firstPage")) {
      e.preventDefault();
      this.goToPage(0);
    } else if (matchesCommand(e, "preview.lastPage")) {
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
    // The next mount gets a fresh scroll container at scrollTop=0 — owe it
    // a snap back to `visiblePage` before the counter may write again.
    this.restorePending = true;
  }

  async handlePageClick(e: MouseEvent, pageIndex: number) {
    // The handler sits on the wrapping <Button>, so `e.target` can be the
    // button itself (keyboard activation, border clicks) — reading natural
    // dimensions off it would send NaN to the backend. Locate the <img> and
    // measure against its rect instead.
    const el = e.currentTarget as HTMLElement;
    const img = el.querySelector("img");
    if (!img || img.naturalWidth === 0) return;
    const rect = img.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
    const py = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;

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
