import { app } from '@tauri-apps/api';
import { setMode, resetMode, systemPrefersMode } from 'mode-watcher';
import { emitAppModeChanged, type ModePreference } from '$lib/ipc/events';
import { logError } from '$lib/logger';

/** Apply and broadcast a color scheme, including the native window chrome. */
export function selectColorScheme(next: ModePreference): void {
    if (next === 'system') {
        resetMode();
    } else {
        setMode(next);
    }
    // mode.current has not settled yet in this tick; resolve from the selection.
    const resolved = next === 'system' ? (systemPrefersMode.current ?? 'light') : next;
    app.setTheme(resolved).catch((err) => logError('setting window theme failed:', err));
    emitAppModeChanged(next).mapErr((err) => logError('mode broadcast failed:', err));
}
