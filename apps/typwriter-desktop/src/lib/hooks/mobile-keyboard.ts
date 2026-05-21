// mobile-keyboard.ts — keep focused inputs above the on-screen keyboard.
//
// AndroidManifest sets `windowSoftInputMode="adjustResize"` so the WebView
// layout viewport shrinks when the keyboard appears. That handles the
// position of fixed/absolute chrome (bottom tab bar, etc.) automatically,
// but a regular `<input>` that was tapped near the bottom of the page can
// still end up sitting on the boundary or behind the keyboard while the
// browser decides whether to scroll it into view.
//
// The visualViewport API gives us a reliable signal for "keyboard is open":
// `window.innerHeight - visualViewport.height` is the keyboard's height in
// CSS pixels (zero when the keyboard is dismissed). We listen for two
// triggers and scroll the focused field into view when either fires:
//   • `focusin` on a text input — the user just tapped a field, the
//     keyboard is animating in.
//   • `visualViewport.resize` with a meaningful height delta — the keyboard
//     opened/closed after focus was already established.
//
// CodeMirror is intentionally skipped: it owns its own viewport and cursor
// scroll, and our global `scrollIntoView` fights its measurement loop.

import { platform } from '$lib/stores/platform.svelte';

const KEYBOARD_DELTA_THRESHOLD_PX = 80;

function isTextLikeInput(el: Element | null): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;

    if (el.tagName === 'TEXTAREA') return true;

    if (el.tagName === 'INPUT') {
        const type = (el as HTMLInputElement).type.toLowerCase();
        return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image', 'color', 'range'].includes(type);
    }

    if (el.isContentEditable) {
        // CodeMirror's `.cm-content` is contenteditable. It handles cursor
        // tracking on its own — interfering causes visible jitter.
        if (el.closest('.cm-editor')) return false;
        return true;
    }

    return false;
}

/**
 * Install global keyboard-avoiding behavior on mobile. No-op on desktop.
 * Returns a teardown function suitable for use inside `$effect` cleanups
 * or `onMount` returns.
 */
export function installKeyboardAvoider(): () => void {
    if (!platform.isMobile) return () => {};
    if (typeof window === 'undefined') return () => {};
    const raw = window.visualViewport;
    if (!raw) return () => {};
    // Rebind to a guaranteed-non-null local so TS narrowing carries into
    // the event handlers below.
    const vv: VisualViewport = raw;

    let lastHeight = vv.height;
    let scrollScheduled = false;

    function scheduleScrollIntoView() {
        if (scrollScheduled) return;
        scrollScheduled = true;
        // Two rAFs: first lets the browser commit the layout change from the
        // keyboard appearing; second lets `scrollIntoView` work against the
        // new viewport size.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollScheduled = false;
                doScrollIntoView();
            });
        });
    }

    function doScrollIntoView() {
        const el = document.activeElement;
        if (!isTextLikeInput(el)) return;

        const rect = el.getBoundingClientRect();
        const visibleTop = vv.offsetTop;
        const visibleBottom = vv.offsetTop + vv.height;

        // Only scroll when the field actually overlaps the keyboard area or
        // sits above the visible viewport. Spurious scrolls are jarring.
        const margin = 16;
        if (rect.bottom > visibleBottom - margin || rect.top < visibleTop + margin) {
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch {
                el.scrollIntoView();
            }
        }

        // Also expose the keyboard inset as a CSS custom property so
        // components (popovers, dialogs) can shift their max-height if they
        // need to.
        const inset = Math.max(0, window.innerHeight - vv.height);
        document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    }

    function onResize() {
        const inset = Math.max(0, window.innerHeight - vv.height);
        document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);

        // Only react to large height swings — page layout/zoom changes can
        // also trigger tiny resizes that we don't care about.
        if (Math.abs(vv.height - lastHeight) > KEYBOARD_DELTA_THRESHOLD_PX) {
            lastHeight = vv.height;
            scheduleScrollIntoView();
        }
    }

    function onFocusIn() {
        scheduleScrollIntoView();
    }

    function onFocusOut() {
        document.documentElement.style.setProperty('--keyboard-inset', '0px');
    }

    vv.addEventListener('resize', onResize);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.documentElement.style.setProperty('--keyboard-inset', '0px');

    return () => {
        vv.removeEventListener('resize', onResize);
        document.removeEventListener('focusin', onFocusIn);
        document.removeEventListener('focusout', onFocusOut);
        document.documentElement.style.removeProperty('--keyboard-inset');
    };
}
