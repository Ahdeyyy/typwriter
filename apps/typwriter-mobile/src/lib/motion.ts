// Motion tokens for Svelte transitions. The curves are the same ones
// `routes/layout.css` declares as `--ease-*`; keep the two in step.
//
// Svelte transitions compile to CSS keyframes, so these run off the main
// thread like any other CSS animation — they only need the curve as a JS
// function to sample it.

import type { TransitionConfig } from "svelte/transition";

/** A CSS `cubic-bezier(x1, y1, x2, y2)` as an easing function of t ∈ [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  // Solve x(u) = t for u: Newton first, bisection if the slope flattens out.
  const solve = (t: number) => {
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(u) - t;
      if (Math.abs(err) < 1e-6) return u;
      const d = slopeX(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    while (lo < hi) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-6) return u;
      if (t > x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
      if (hi - lo < 1e-6) break;
    }
    return u;
  };

  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sampleY(solve(t)));
}

export const easeOut = cubicBezier(0.23, 1, 0.32, 1);
export const easeInOut = cubicBezier(0.77, 0, 0.175, 1);

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A full-screen layer arriving over (or leaving) the screen beneath it —
 * Material's shared-axis Z: a slight scale plus a fade. Reduced motion keeps
 * the fade and drops the scale.
 */
export function screen(
  _node: Element,
  { duration = 240, scale = 0.96 }: { duration?: number; scale?: number } = {},
): TransitionConfig {
  const reduce = prefersReducedMotion();
  return {
    duration: reduce ? Math.min(duration, 150) : duration,
    easing: easeOut,
    css: (t) =>
      reduce
        ? `opacity: ${t};`
        : `opacity: ${t}; transform: scale(${scale + (1 - scale) * t});`,
  };
}

/**
 * A panel that drops in from the edge it is anchored to (`y` in px; negative
 * comes from above). Reduced motion keeps only the fade.
 */
export function drop(
  _node: Element,
  { duration = 220, y = -12 }: { duration?: number; y?: number } = {},
): TransitionConfig {
  const reduce = prefersReducedMotion();
  return {
    duration: reduce ? Math.min(duration, 150) : duration,
    easing: easeOut,
    css: (t, u) => (reduce ? `opacity: ${t};` : `opacity: ${t}; transform: translateY(${u * y}px);`),
  };
}
