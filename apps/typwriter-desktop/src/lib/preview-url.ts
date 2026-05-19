import { convertFileSrc } from '@tauri-apps/api/core';

/** Build the URL the webview uses to fetch a rendered preview page.
 *
 *  The Rust side registers a `previewimg` URI scheme that serves PNG bytes
 *  keyed by `PageFingerprint`. Going through the URI scheme keeps the IPC
 *  event payload tiny (just the hex fingerprint) and lets the webview cache
 *  by URL — re-displaying a page that was already rendered costs nothing.
 *
 *  Tauri's `convertFileSrc` handles per-platform URL shape:
 *    - Windows / Android → `http://previewimg.localhost/{fp}.png`
 *    - macOS / iOS / Linux → `previewimg://localhost/{fp}.png`
 */
export function buildPreviewUrl(fingerprint: string): string {
    return convertFileSrc(`${fingerprint}.png`, 'previewimg');
}
