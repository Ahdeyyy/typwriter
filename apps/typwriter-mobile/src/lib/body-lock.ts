// Safety net for the modal scroll lock.
//
// While a modal is open, bits-ui puts `overflow: hidden; pointer-events: none`
// on `<body>` and takes it off again when the content *unmounts* — which it
// only does once the exit transition reports it has finished. If that report
// never arrives, or two stacked modals (the file-tree sheet and a drawer opened
// from inside it) tear down together and the restore lands out of order, the
// inline `pointer-events: none` survives with nothing left to remove it. The
// app then renders perfectly and ignores every tap, which is fatal: no gesture
// can recover it, only a restart. Switching workspaces from the file tree is
// the one flow that closes two stacked modals and then rebuilds the whole
// editor in the same tick, and it is where this was reported.
//
// So: whenever the app settles back to "no overlay", verify the page is still
// interactive and clear the residue if it isn't. The check is conservative —
// it does nothing while any modal is actually open — and cheap enough to run on
// every overlay close rather than only when we suspect trouble.

/** Modal surfaces that legitimately hold the body lock while open. */
const MODAL_CONTENT =
  '[data-slot="sheet-content"],[data-slot="drawer-content"],[data-slot="dialog-content"],[data-vaul-drawer]';

/**
 * Exit transitions to wait out before judging the body stuck. The sheet's is
 * 200 ms and vaul's is 500 ms; check after both, and once more later in case a
 * transition that never completed keeps its element mounted.
 */
const CHECK_DELAYS_MS = [300, 700, 1200];

let timers: ReturnType<typeof setTimeout>[] = [];

function anyModalOpen(): boolean {
  for (const el of document.querySelectorAll(MODAL_CONTENT)) {
    if (el.getAttribute("data-state") === "open") return true;
  }
  return false;
}

/** Drop a body lock that outlived the modal that installed it. */
function releaseIfStuck() {
  const body = document.body;
  if (body.style.pointerEvents !== "none" || anyModalOpen()) return;
  console.warn("body-lock: releasing a modal lock that outlived its modal");
  body.style.removeProperty("pointer-events");
  body.style.removeProperty("overflow");
  body.style.removeProperty("--scrollbar-width");
}

/**
 * Schedule the check. Call whenever the app returns to a state where nothing
 * should be holding the lock. Repeat calls restart the schedule, so a burst of
 * overlay changes costs one pass.
 */
export function scheduleBodyLockRelease() {
  if (typeof document === "undefined") return;
  for (const timer of timers) clearTimeout(timer);
  timers = CHECK_DELAYS_MS.map((delay) => setTimeout(releaseIfStuck, delay));
}
