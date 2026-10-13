// Adapts the Rust `lsp://*` event bridge to a `@codemirror/lsp-client` `Transport`.
//
// The Rust side emits each de-framed server message as an `lsp://message`
// Tauri event and accepts outbound messages via the `lsp_send` command.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Transport } from '@codemirror/lsp-client';
import { lspSend } from '$lib/ipc/commands';
import { logError } from '$lib/logger';

export interface TauriLspTransport extends Transport {
    dispose(): void;
}

export async function createTauriLspTransport(): Promise<TauriLspTransport> {
    const handlers = new Set<(value: string) => void>();
    let pending = Promise.resolve();
    let disposed = false;

    // Await the listener before returning so no early server messages are
    // dropped between connect() and the first subscribe().
    const unlisten: UnlistenFn = await listen<string>('lsp://message', (event) => {
        for (const handler of handlers) handler(event.payload);
    });

    return {
        send(message) {
            // Tauri runs lsp_send on worker threads. Preserve wire order so
            // didOpen/didChange reaches tinymist before the query using it.
            pending = pending.then(async () => {
                if (disposed) return;
                await lspSend(message).mapErr((err) => logError('lsp send failed:', err));
            }).catch((err) => logError('lsp send failed:', err));
        },
        subscribe(handler) {
            handlers.add(handler);
        },
        unsubscribe(handler) {
            handlers.delete(handler);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            handlers.clear();
            unlisten();
        },
    };
}
