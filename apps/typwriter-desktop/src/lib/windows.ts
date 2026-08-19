// Child webview windows (settings, version diff).
//
// Each helper follows the preview-popout pattern in workspace.svelte: reuse
// the window if it already exists (focus + optionally re-seed its state via
// the event bus), otherwise create it pointed at `/?window=<role>` so
// +page.svelte can route to the right standalone page.
//
// Orphan safety: the Rust `on_window_event` handler in lib.rs destroys every
// non-main window when the main window closes, so none of these can outlive
// the app no matter which close path fires.
//
// All child windows are created with `decorations: false` to match the main
// window; each standalone page renders the shared custom <Titlebar> instead.
//
// They are also created *hidden* — see `childWindowChrome` below.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import { emitVcsDiffSelection } from '$lib/ipc/events';
import { logError } from '$lib/logger';

export const SETTINGS_WINDOW_LABEL = 'settings';
export const DIFF_WINDOW_LABEL = 'diff';

/** Resolve the current theme's page background to a hex string.
 *
 *  The window needs a concrete colour at creation time — before the child's
 *  WebView exists, let alone its stylesheet — and `--background` is authored
 *  as `oklch(...)`, which Tauri won't parse. Reading the *creating* window's
 *  computed body background gives the already-resolved rgb for whatever theme
 *  is active, which is what the child will paint anyway. */
function currentBackgroundHex(): string {
    if (typeof document === 'undefined') return '#000000';
    const computed = getComputedStyle(document.body).backgroundColor;
    const parts = computed.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return '#000000';
    const hex = parts
        .slice(0, 3)
        .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
    return `#${hex}`;
}

/** Creation options every child window shares.
 *
 *  `visible: false` is the important one: a WebView that is on screen from the
 *  moment it is created paints its own blank surface, then an empty body, then
 *  the themed UI — three visible states, which read as a flicker. Hidden
 *  windows skip straight to the last one; `revealCurrentWindow` (called from
 *  `+page.svelte` once the window's role component has painted) puts them on
 *  screen. `backgroundColor` covers the frames the compositor draws outside
 *  the WebView's own paint — notably while the window is being resized. */
export function childWindowChrome() {
    return {
        decorations: false,
        resizable: true,
        visible: false,
        backgroundColor: currentBackgroundHex(),
    } as const;
}

/** How long to wait for a child window to render before showing it anyway.
 *  This only covers the pathological case — a chunk that never loads, a render
 *  that never completes — where the alternative is a window the user opened
 *  that never appears. It is not part of the normal path. */
const REVEAL_FALLBACK_MS = 2000;

let revealed = false;

/** Put this window on screen. Safe to call more than once, and a no-op in the
 *  main window, which the Tauri config creates already visible.
 *
 *  Deliberately *not* `requestAnimationFrame`: a window created with
 *  `visible: false` is never composited, so its WebView throttles animation
 *  frames and the callback may not run until the window is already showing —
 *  which is a deadlock, since showing it is what the callback was for.
 *  Forcing layout instead gives the same guarantee that matters (the DOM the
 *  WebView is about to composite is fully resolved) without waiting on a frame
 *  that will never come. */
export function revealCurrentWindow(): void {
    if (revealed) return;
    revealed = true;

    const win = getCurrentWindow();
    if (win.label === 'main') return;

    // Reading a layout property flushes pending style and layout synchronously.
    if (typeof document !== 'undefined') void document.body.offsetHeight;

    win.show()
        .then(() => win.setFocus())
        .catch((err) => logError(`${win.label} window show failed:`, err));
}

/** Arm the safety net that shows this window even if it never finishes
 *  rendering. Called once, at module load of the page that owns the reveal. */
export function armRevealFallback(): void {
    setTimeout(revealCurrentWindow, REVEAL_FALLBACK_MS);
}

/** Which tab the version-diff window shows. */
export type DiffWindowView = 'files' | 'pages';

async function focusExisting(label: string): Promise<WebviewWindow | null> {
    const existing = await WebviewWindow.getByLabel(label);
    if (!existing) return null;
    try {
        await existing.unminimize();
        await existing.setFocus();
    } catch (err) {
        logError(`${label} window focus failed:`, err);
    }
    return existing;
}

/**
 * Open (or focus) the settings window.
 *
 * `group` seeds which pane it lands on, via the URL — the same mechanism the
 * preview and diff windows use for their initial state. An already-open window
 * is only focused: re-navigating it would discard whatever the user was in the
 * middle of editing there.
 */
export async function openSettingsWindow(group?: string): Promise<void> {
    if (await focusExisting(SETTINGS_WINDOW_LABEL)) return;

    const params = new URLSearchParams({ window: 'settings' });
    if (group) params.set('group', group);

    const win = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
        url: `/?${params}`,
        title: 'Settings - Typwriter',
        width: 880,
        height: 720,
        minWidth: 480,
        minHeight: 400,
        ...childWindowChrome(),
    });
    win.once('tauri://error', (event) => {
        logError('settings window creation failed:', event.payload);
    });
}

/** Open (or retarget) the version-diff window for the given selection.
 *  `primaryId` is the anchor restore point; `secondaryId`, when set, makes it
 *  a two-point diff instead of "point vs current". `view` picks which tab it
 *  lands on — `'pages'` goes straight to the rendered-page comparison, which
 *  is what the ledger's "compare pages" action wants. */
export async function openDiffWindow(
    primaryId: string | null,
    secondaryId: string | null,
    view: DiffWindowView = 'files'
): Promise<void> {
    if (!primaryId) return;

    const existing = await focusExisting(DIFF_WINDOW_LABEL);
    if (existing) {
        // Already open: retarget it over the event bus instead of recreating.
        emitVcsDiffSelection({ primaryId, secondaryId, view }).mapErr((err) =>
            logError('diff window retarget failed:', err)
        );
        return;
    }

    // Seed the selection via the URL — the new window's stores boot empty and
    // must know what to diff before their first render.
    const params = new URLSearchParams({ window: 'diff', primary: primaryId, view });
    if (secondaryId) params.set('secondary', secondaryId);

    const win = new WebviewWindow(DIFF_WINDOW_LABEL, {
        url: `/?${params}`,
        title: 'Version Diff - Typwriter',
        width: 1000,
        height: 800,
        minWidth: 520,
        minHeight: 400,
        ...childWindowChrome(),
    });
    win.once('tauri://error', (event) => {
        logError('diff window creation failed:', event.payload);
    });
}

/** Tear down the diff window if it's open. Called when its subject disappears
 *  (workspace restored / workspace closed). */
export async function closeDiffWindow(): Promise<void> {
    try {
        const existing = await WebviewWindow.getByLabel(DIFF_WINDOW_LABEL);
        await existing?.destroy();
    } catch (err) {
        logError('diff window close failed:', err);
    }
}
