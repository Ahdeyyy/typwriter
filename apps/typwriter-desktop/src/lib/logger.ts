import { error as tauriError, info as tauriInfo } from '@tauri-apps/plugin-log';
import { toast } from 'svelte-sonner';

type LogValue = unknown;

function formatLogValue(value: LogValue): string {
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }

    if (typeof value === 'string') {
        return value;
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint' ||
        typeof value === 'symbol' ||
        value === null ||
        value === undefined
    ) {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function formatLogMessage(values: LogValue[]): string {
    return values.map((value) => formatLogValue(value)).join(' ');
}

export function logError(...values: LogValue[]): void {
    console.error(...values);

    const message = formatLogMessage(values);
    if (!message) {
        return;
    }


    void tauriError(message).catch(() => {
        // Keep app behavior stable when running outside a Tauri context.
    });
}

// ─── Preview-jump debug tracing ──────────────────────────────────────────────
//
// Instruments every stage that can move the preview's scroll position or change
// the reported page number, so the "preview jumps around while editing" bug can
// be traced end-to-end. Each line is prefixed `[preview-trace]` and tagged with
// a stage name; filter the log file (or devtools console) on that prefix to read
// the timeline of a single reproduction.
//
// Toggle at runtime from the devtools console: `window.__previewTrace(false)`.
let previewTraceEnabled = true;

export function setPreviewTrace(on: boolean): void {
    previewTraceEnabled = on;
}

if (typeof window !== 'undefined') {
    (window as unknown as { __previewTrace: (on: boolean) => void }).__previewTrace =
        setPreviewTrace;
}

/**
 * Emit one structured trace line for a preview pipeline stage.
 *
 * @param stage  short kebab/colon tag for the stage, e.g. `scroll:apply`.
 * @param data   stage-specific fields (indices, scroll offsets, counts, …).
 *               Serialized to JSON so the values survive into the log file.
 */
export function logPreview(stage: string, data?: Record<string, LogValue>): void {
    if (!previewTraceEnabled) return;

    const detail = data === undefined ? '' : ` ${formatLogValue(data)}`;
    const message = `[preview-trace] ${stage}${detail}`;

    console.debug(message);
    // Mirror to the Tauri log file at info level so traces are captured even
    // when devtools isn't open (e.g. reproducing on Android / a popout window).
    void tauriInfo(message).catch(() => {
        // Outside a Tauri context the console line above is enough.
    });
}

export function installGlobalErrorLogging(): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const onError = (event: ErrorEvent) => {
        // ResizeObserver loop errors are a benign browser notification (not a real error).
        if (typeof event.message === 'string' && event.message.includes('ResizeObserver loop')) {
            return;
        }
        logError('uncaught window error:', event.error ?? event.message);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        logError('unhandled promise rejection:', event.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
}
