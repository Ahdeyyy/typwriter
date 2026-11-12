// Android-style touch ripple, installed once at the root and delegated to every
// pressable element, so call sites never opt in one by one.
//
// - The wave waits `TAP_DELAY` before it starts, like the platform does: a
//   finger that lands on a row and then scrolls should not flash it. A release
//   inside that window starts the wave immediately.
// - Rapid-fire surfaces (the symbol toolbar, the completion strip, the cursor
//   row) behave like keyboard keys and opt out with `data-no-ripple` on a
//   container. So does CodeMirror.
// - The ripple's own nodes are removed once it fades, so nothing foreign stays
//   inside a Svelte-managed element.

import { prefersReducedMotion } from "$lib/motion";

const PRESSABLE =
  'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [data-ripple]';
const TAP_DELAY = 70;
const TAP_SLOP = 10;
const EXPAND_MS = 260;
const FADE_MS = 200;
/** A wave released early still shows for this long, or a quick tap reads as nothing. */
const MIN_VISIBLE_MS = 110;

function pressableFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-no-ripple], .cm-editor")) return null;
  const el = target.closest<HTMLElement>(PRESSABLE);
  if (!el) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  if (el.hasAttribute("data-disabled")) return null;
  return el;
}

function startWave(el: HTMLElement, clientX: number, clientY: number) {
  // The host must be the wave's containing block. Most pressables are static
  // flex boxes; promoting them to `relative` changes nothing else about them.
  if (getComputedStyle(el).position === "static") el.style.position = "relative";

  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  // Big enough to cover the farthest corner from the touch point.
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));

  const host = document.createElement("span");
  host.className = "ripple-host";
  host.setAttribute("aria-hidden", "true");
  const wave = document.createElement("span");
  wave.className = "ripple-wave";
  wave.style.width = wave.style.height = `${radius * 2}px`;
  wave.style.left = `${x - radius}px`;
  wave.style.top = `${y - radius}px`;
  host.append(wave);
  el.append(host);

  const started = performance.now();
  const reduce = prefersReducedMotion();
  // Reduced motion: the state layer appears without spreading.
  wave.animate(
    reduce
      ? [{ opacity: 0 }, { opacity: 0.12 }]
      : [{ transform: "scale(0.2)" }, { transform: "scale(1)" }],
    { duration: reduce ? 100 : EXPAND_MS, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" },
  );

  return function release() {
    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - started));
    window.setTimeout(() => {
      const fade = wave.animate([{ opacity: 0.12 }, { opacity: 0 }], {
        duration: FADE_MS,
        easing: "ease-out",
        fill: "forwards",
      });
      fade.onfinish = () => host.remove();
      fade.oncancel = () => host.remove();
    }, wait);
  };
}

/** Install the delegated ripple. Returns the teardown. */
export function installRipple(root: Document = document): () => void {
  let pending: {
    el: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    timer: number;
    release: (() => void) | null;
  } | null = null;

  const cancel = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.release?.();
    pending = null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    cancel();
    const el = pressableFrom(e.target);
    if (!el) return;
    const p = {
      el,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: 0,
      release: null as (() => void) | null,
    };
    p.timer = window.setTimeout(() => {
      p.release = startWave(p.el, p.x, p.y);
    }, TAP_DELAY);
    pending = p;
  };

  const onMove = (e: PointerEvent) => {
    if (!pending || e.pointerId !== pending.pointerId || pending.release) return;
    // Still inside the tap delay and the finger is travelling: it's a scroll.
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > TAP_SLOP) {
      window.clearTimeout(pending.timer);
      pending = null;
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (!pending.release) {
      window.clearTimeout(pending.timer);
      pending.release = startWave(pending.el, pending.x, pending.y);
    }
    cancel();
  };

  const onCancel = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.pointerId) cancel();
  };

  root.addEventListener("pointerdown", onDown, { passive: true, capture: true });
  root.addEventListener("pointermove", onMove, { passive: true, capture: true });
  root.addEventListener("pointerup", onUp, { passive: true, capture: true });
  root.addEventListener("pointercancel", onCancel, { passive: true, capture: true });
  return () => {
    cancel();
    root.removeEventListener("pointerdown", onDown, { capture: true });
    root.removeEventListener("pointermove", onMove, { capture: true });
    root.removeEventListener("pointerup", onUp, { capture: true });
    root.removeEventListener("pointercancel", onCancel, { capture: true });
  };
}
