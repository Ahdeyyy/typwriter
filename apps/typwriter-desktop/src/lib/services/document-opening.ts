import { open } from '@tauri-apps/plugin-dialog';
import { toast } from 'svelte-sonner';
import { SerialQueue } from '$lib/async';
import { takeOpenRequests } from '$lib/ipc/commands';
import { onAppOpenFiles, type UnlistenFn } from '$lib/ipc/events';
import { workspace } from '$lib/stores/workspace.svelte';
import { page } from '$lib/stores/page.svelte';
import { normalize } from '$lib/paths';
import { logError } from '$lib/logger';
import { closeDiffWindow } from '$lib/windows';

const queue = new SerialQueue();
const pending = new Map<string, Promise<void>>();
let startup: Promise<boolean> | null = null;
let unlisten: UnlistenFn | null = null;
let stopped = false;

/** Picker, recents and OS delivery all use the same serialized transition. */
export function openDocumentPath(path: string, root?: string): Promise<void> {
    const key = `${normalize(path)}\0${root ? normalize(root) : ''}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const request = queue.run(async () => {
        if (page.current.name === 'onboarding') {
            const { onboarding } = await import('$lib/stores/onboarding.svelte');
            const finished = await onboarding.finish();
            if (finished.isErr()) {
                toast.error(`Could not close the tutorial: ${finished.error}`);
                return;
            }
        }
        const result = await workspace.openDocument(path, root);
        if (result.isErr()) {
            logError('Opening document failed:', result.error);
            toast.error(`Could not open ${path}: ${result.error}`);
            return;
        }
        await closeDiffWindow();
        page.navigate('workspace');
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
}

export async function chooseDocument(): Promise<void> {
    try {
        const selected = await open({
            title: 'Open Typst document', multiple: false,
            filters: [{ name: 'Typst document', extensions: ['typ'] }],
        });
        if (typeof selected === 'string') await openDocumentPath(selected);
    } catch (error) {
        toast.error(`Could not open the file picker: ${String(error)}`);
    }
}

async function drain(): Promise<boolean> {
    const result = await takeOpenRequests();
    if (result.isErr()) {
        logError('Reading file-open requests failed:', result.error);
        toast.error(`Could not read files opened from the file manager: ${result.error}`);
        return false;
    }
    // The application has one active document. Multiple OS requests are opened
    // in order and remembered in Recents, leaving the last one visible.
    for (const path of new Set(result.value.map(normalize))) {
        if (stopped) break;
        await openDocumentPath(path);
    }
    return result.value.length > 0;
}

const drains = new SerialQueue();

/** Subscribe before taking the startup queue, so no activation is lost. The
 * returned flag keeps first-launch onboarding from replacing an OS-opened file. */
export function initializeDocumentOpening(): Promise<boolean> {
    if (startup) return startup;
    stopped = false;
    startup = (async () => {
        const listener = await onAppOpenFiles(() => {
            void drains.run(drain);
        });
        if (listener.isOk()) {
            if (stopped) listener.value();
            else unlisten = listener.value;
        } else {
            logError('File-open listener failed:', listener.error);
        }
        return stopped ? false : drains.run(drain);
    })();
    return startup;
}

export function destroyDocumentOpening(): void {
    stopped = true;
    unlisten?.();
    unlisten = null;
    startup = null;
}
