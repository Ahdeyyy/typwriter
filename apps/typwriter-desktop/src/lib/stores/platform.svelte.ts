// Platform detection. Viewport-based so it tracks window resize during dev,
// and naturally resolves to `mobile` on Tauri mobile (small viewport).
// Swap to @tauri-apps/plugin-os if a stricter OS check is ever needed.

const MOBILE_MAX_WIDTH = 768;

class PlatformStore {
  width = $state(typeof window !== "undefined" ? window.innerWidth : 1024);
  isMobile = $derived(this.width < MOBILE_MAX_WIDTH);
  isDesktop = $derived(!this.isMobile);

  constructor() {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", () => {
      this.width = window.innerWidth;
    });
  }
}

export const platform = new PlatformStore();
