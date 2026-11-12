// Form factor: phone vs tablet, and whether a tablet is wide enough to dock
// the file tree and the preview beside the editor.
//
// "Tablet" follows Android's sw600dp rule — the screen's *smallest* side — and
// never the window's height: the soft keyboard shrinks the window
// (`adjustResize`), and a layout that flipped when it opened would throw the
// editor around mid-typing. Width is safe to follow live: the keyboard never
// changes it, and split-screen narrows it on purpose. A phone turned landscape
// stays a phone (its smallest side is still ~400dp).
//
// The `tablet` / `wide` classes on <html> back the Tailwind variants of the
// same names (see `routes/layout.css`), so styling needs no JS branch.

/** Smallest screen side, in dp, that counts as a tablet (Android's sw600dp). */
const TABLET_MIN_DP = 600;
/** Window width that fits a docked sidebar + editor + preview. */
const WIDE_MIN_PX = 1000;

function measure() {
  if (typeof window === "undefined") return { tablet: false, wide: false };
  const tablet =
    Math.min(window.screen.width, window.screen.height) >= TABLET_MIN_DP &&
    window.innerWidth >= TABLET_MIN_DP;
  return { tablet, wide: tablet && window.innerWidth >= WIDE_MIN_PX };
}

class LayoutStore {
  tablet = $state(false);
  wide = $state(false);
  /** Docked file tree (wide only). Open by default — it is the point of the
   *  extra width. */
  sidebarOpen = $state(true);
  /** The user asked for the docked preview (wide only). Off by default: a
   *  visible preview recompiles on every idle-save. */
  previewPinned = $state(false);

  private cleanup: (() => void) | null = null;

  constructor() {
    // Measured synchronously so the first frame already has the right layout.
    this.apply();
  }

  /** Whether the docked file tree is showing. */
  get sidebarDocked(): boolean {
    return this.wide && this.sidebarOpen;
  }

  /** Whether the docked preview is showing. */
  get previewDocked(): boolean {
    return this.wide && this.previewPinned;
  }

  init() {
    if (this.cleanup || typeof window === "undefined") return;
    const target = window;
    const onResize = () => this.apply();
    target.addEventListener("resize", onResize);
    this.cleanup = () => target.removeEventListener("resize", onResize);
    this.apply();
  }

  destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }

  private apply() {
    const next = measure();
    this.tablet = next.tablet;
    this.wide = next.wide;
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("tablet", next.tablet);
      document.documentElement.classList.toggle("wide", next.wide);
    }
  }
}

export const layout = new LayoutStore();
