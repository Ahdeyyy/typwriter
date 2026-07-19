// windows.ts — child webview windows (settings, version diff).
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

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import { emitVcsDiffSelection } from '$lib/ipc/events';
import { logError } from '$lib/logger';

export const SETTINGS_WINDOW_LABEL = 'settings';
export const DIFF_WINDOW_LABEL = 'diff';

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

export async function openSettingsWindow(): Promise<void> {
    if (await focusExisting(SETTINGS_WINDOW_LABEL)) return;

    const win = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
        url: '/?window=settings',
        title: 'Settings - Typwriter',
        width: 880,
        height: 720,
        minWidth: 480,
        minHeight: 400,
        decorations: false,
        resizable: true,
    });
    win.once('tauri://error', (event) => {
        logError('settings window creation failed:', event.payload);
    });
}

/** Open (or retarget) the version-diff window for the given selection.
 *  `primaryId` is the anchor restore point; `secondaryId`, when set, makes it
 *  a two-point diff instead of "point vs current". */
export async function openDiffWindow(
    primaryId: string | null,
    secondaryId: string | null
): Promise<void> {
    if (!primaryId) return;

    const existing = await focusExisting(DIFF_WINDOW_LABEL);
    if (existing) {
        // Already open: retarget it over the event bus instead of recreating.
        emitVcsDiffSelection({ primaryId, secondaryId }).mapErr((err) =>
            logError('diff window retarget failed:', err)
        );
        return;
    }

    // Seed the selection via the URL — the new window's stores boot empty and
    // must know what to diff before their first render.
    const params = new URLSearchParams({ window: 'diff', primary: primaryId });
    if (secondaryId) params.set('secondary', secondaryId);

    const win = new WebviewWindow(DIFF_WINDOW_LABEL, {
        url: `/?${params}`,
        title: 'Version Diff - Typwriter',
        width: 1000,
        height: 800,
        minWidth: 520,
        minHeight: 400,
        decorations: false,
        resizable: true,
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
