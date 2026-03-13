import { error as tauriError } from '@tauri-apps/plugin-log';

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
