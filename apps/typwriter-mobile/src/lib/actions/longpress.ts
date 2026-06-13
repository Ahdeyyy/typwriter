// Long-press gesture for touch (no right-click on mobile). pointerdown starts a
// timer; movement > 8px or an early pointerup/leave cancels it; otherwise it
// fires after ~450ms.

interface LongpressOptions {
  duration?: number;
  onLongpress: (e: PointerEvent) => void;
}

const MOVE_TOLERANCE = 8;

export function longpress(node: HTMLElement, options: LongpressOptions) {
  let opts = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      opts.onLongpress(e);
    }, opts.duration ?? 450);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      clear();
    }
  };

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("pointermove", onPointerMove);
  node.addEventListener("pointerup", clear);
  node.addEventListener("pointercancel", clear);
  node.addEventListener("pointerleave", clear);

  return {
    update(next: LongpressOptions) {
      opts = next;
    },
    destroy() {
      clear();
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", clear);
      node.removeEventListener("pointercancel", clear);
      node.removeEventListener("pointerleave", clear);
    },
  };
}
