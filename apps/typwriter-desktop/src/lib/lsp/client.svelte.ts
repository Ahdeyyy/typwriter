// client.svelte.ts — tinymist language-server lifecycle.
//
// Owns the `@codemirror/lsp-client` `LSPClient`, its transport, and the
// spawn/handshake/teardown state machine. The editor asks this store for a
// per-file CodeMirror extension (`pluginFor`); when tinymist isn't active it
// returns `null` and the editor falls back to the typst-ide IPC path.

import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { lspStart, lspStop } from '$lib/ipc/commands';
import { workspace } from '$lib/stores/workspace.svelte';
import { diagnostics } from '$lib/stores/diagnostics.svelte';
import { platform } from '$lib/stores/platform.svelte';
import { logError, logInfo } from '$lib/logger';
import type { SerializedDiagnostic } from '$lib/types';

import { createTauriLspTransport, type TauriLspTransport } from './transport';

const INIT_TIMEOUT_MS = 10_000;

// ─── Retry policy ─────────────────────────────────────────────────────────────
//
// Spawning/handshaking tinymist can fail transiently (slow cold start, a crash
// on a bad edit, a race on workspace open). Rather than fall back to built-in
// features on the first hiccup, retry with exponential backoff. A genuine
// "tinymist not installed" result is *not* retried — respawning a missing binary
// never succeeds.

/** Total connection attempts before giving up and falling back. */
const MAX_CONNECT_ATTEMPTS = 4;
/** Base backoff; doubles per attempt (1s, 2s, 4s, …), capped by the max below. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 8_000;
/** Delay before reconnecting after the server crashes/exits at runtime. */
const RECONNECT_DELAY_MS = 1_000;

// ─── URI ⇄ path ───────────────────────────────────────────────────────────────
//
// The app's paths are normalized forward-slash absolute paths. `file://` URIs
// need a leading slash before a Windows drive letter (`file:///C:/a`). Use
// `encodeURI`/`decodeURI` (not the `*Component` variants) so `/` and `:` survive.

export function pathToUri(path: string): string {
    const withSlash = path.startsWith('/') ? path : `/${path}`;
    return `file://${encodeURI(withSlash)}`;
}

export function uriToPath(uri: string): string {
    let path = decodeURI(uri.replace(/^file:\/\//, ''));
    // `/C:/a` → `C:/a`
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return path;
}

// ─── Diagnostics mapping ────────────────────────────────────────────────────────

interface LspPosition {
    line: number;
    character: number;
}
interface LspDiagnostic {
    range: { start: LspPosition; end: LspPosition };
    /** 1 = Error, 2 = Warning, 3 = Information, 4 = Hint. */
    severity?: number;
    message: string;
}

/** Map LSP diagnostics into the app's `SerializedDiagnostic` shape. `file_path`
 *  is filled in by the caller. */
export function toSerializedDiagnostics(lspDiags: LspDiagnostic[]): SerializedDiagnostic[] {
    return lspDiags.map((d) => ({
        severity: d.severity === 1 ? 'error' : 'warning',
        message: d.message,
        hints: [],
        file_path: null,
        range: {
            start_line: d.range.start.line,
            start_col: d.range.start.character,
            end_line: d.range.end.line,
            end_col: d.range.end.character,
        },
    }));
}

// ─── Client store ───────────────────────────────────────────────────────────────

class LspClientStore {
    /** True only once a spawned tinymist process has completed the `initialize`
     *  handshake — never a half-connected client. */
    isActive = $state(false);

    private client: LSPClient | null = null;
    private transport: TauriLspTransport | null = null;
    private rootUri: string | null = null;
    private closedUnlisten: UnlistenFn | null = null;

    // The state we currently want: the target root URI when on, `null` when off.
    // Repeated `reconcile` calls with the same target are no-ops.
    private wantKey: string | null = null;
    // Bumped on every reconcile so a stale in-flight connect can detect it's been
    // superseded and bail cleanly.
    private token = 0;
    // Pending backoff timer for a scheduled (re)connect, if any.
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    /** Re-run on every change of the `useLsp` setting or the workspace root.
     *  Idempotent: tears down and reconnects only when the desired state or root
     *  actually changed. */
    reconcile(enabled: boolean, root: string | null): void {
        const desired = enabled && !platform.isMobile && !!root;
        const wantKey = desired && root ? pathToUri(root) : null;
        if (wantKey === this.wantKey) return;

        this.wantKey = wantKey;
        const myToken = ++this.token;
        this.teardown();

        if (!wantKey || !root) return;
        void this.connect(root, myToken, 0);
    }

    private async connect(root: string, myToken: number, attempt: number): Promise<void> {
        const started = await lspStart();
        // A missing binary never becomes present by retrying: fall back for good.
        if (started.isOk() && started.value === false) {
            logInfo('tinymist not found; using built-in language features');
            return;
        }
        if (started.isErr()) {
            logError('lsp start failed:', started.error);
            this.retryOrFallback(root, myToken, attempt);
            return;
        }
        if (myToken !== this.token) {
            void lspStop();
            return;
        }

        const rootUri = pathToUri(root);

        let transport: TauriLspTransport;
        try {
            transport = await createTauriLspTransport();
        } catch (err) {
            logError('lsp transport setup failed:', err);
            void lspStop();
            this.retryOrFallback(root, myToken, attempt);
            return;
        }
        if (myToken !== this.token) {
            transport.dispose();
            void lspStop();
            return;
        }

        const client = new LSPClient({
            rootUri,
            extensions: languageServerExtensions(),
            notificationHandlers: {
                'textDocument/publishDiagnostics': (_client, params) => {
                    // Mirror into the store so the diagnostics *pane* (which reads
                    // the store, not any one editor view) stays in sync. Return
                    // `false` so `serverDiagnostics` still renders the lint gutter.
                    const relPath = workspace.toRel(uriToPath(params.uri));
                    diagnostics.setLspDiagnostics(
                        relPath,
                        toSerializedDiagnostics(params.diagnostics ?? []),
                    );
                    return false;
                },
            },
        });
        client.connect(transport);

        const initialized = await Promise.race([
            client.initializing.then(() => true).catch(() => false),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), INIT_TIMEOUT_MS)),
        ]);
        if (!initialized || myToken !== this.token) {
            try {
                client.disconnect();
            } catch {
                /* already gone */
            }
            transport.dispose();
            void lspStop();
            if (!initialized && myToken === this.token) {
                logError('tinymist failed to initialize');
                this.retryOrFallback(root, myToken, attempt);
            }
            return;
        }

        // tinymist crashed/exited at runtime → tear down and try to reconnect
        // (with a fresh attempt budget) before falling back to built-in features.
        const closedUnlisten = await listen('lsp://closed', () => {
            if (myToken !== this.token) return;
            logInfo('tinymist language server exited; attempting to reconnect');
            const reconnectToken = ++this.token;
            this.teardown();
            if (this.wantKey === rootUri) {
                this.scheduleConnect(root, reconnectToken, 0, RECONNECT_DELAY_MS);
            }
        });
        if (myToken !== this.token) {
            closedUnlisten();
            try {
                client.disconnect();
            } catch {
                /* already gone */
            }
            transport.dispose();
            void lspStop();
            return;
        }

        this.client = client;
        this.transport = transport;
        this.rootUri = rootUri;
        this.closedUnlisten = closedUnlisten;
        this.isActive = true;
        diagnostics.setLspActive(true);
        logInfo('tinymist language server connected');
    }

    /** After a failed attempt, schedule the next one with exponential backoff, or
     *  give up (fall back to built-in features) once the budget is exhausted.
     *  No-op if this connect flow has already been superseded. */
    private retryOrFallback(root: string, myToken: number, attempt: number): void {
        if (myToken !== this.token) return;
        const nextAttempt = attempt + 1;
        if (nextAttempt >= MAX_CONNECT_ATTEMPTS) {
            logError(
                `tinymist connection failed after ${MAX_CONNECT_ATTEMPTS} attempts; using built-in language features`,
            );
            return;
        }
        const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
        logInfo(
            `retrying tinymist connection (attempt ${nextAttempt + 1}/${MAX_CONNECT_ATTEMPTS}) in ${delay}ms`,
        );
        this.scheduleConnect(root, myToken, nextAttempt, delay);
    }

    /** Arm a single pending (re)connect after `delayMs`, replacing any prior one.
     *  The fire is a no-op if the flow has since been superseded. */
    private scheduleConnect(root: string, myToken: number, attempt: number, delayMs: number): void {
        this.clearRetryTimer();
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (myToken !== this.token) return;
            void this.connect(root, myToken, attempt);
        }, delayMs);
    }

    private clearRetryTimer(): void {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    private teardown(): void {
        // Cancel any pending backoff so a superseded flow can't reconnect.
        this.clearRetryTimer();
        // Drop the closed-listener first so killing the child doesn't re-trigger it.
        if (this.closedUnlisten) {
            this.closedUnlisten();
            this.closedUnlisten = null;
        }
        const hadClient = this.client !== null;
        this.isActive = false;
        diagnostics.setLspActive(false);
        if (this.client) {
            try {
                this.client.disconnect();
            } catch {
                /* already gone */
            }
            this.client = null;
        }
        if (this.transport) {
            this.transport.dispose();
            this.transport = null;
        }
        this.rootUri = null;
        if (hadClient) void lspStop();
    }

    /** The per-file CodeMirror extension for `absPath`, or `null` when tinymist
     *  isn't active. */
    pluginFor(absPath: string): Extension | null {
        if (!this.isActive || !this.client) return null;
        return this.client.plugin(pathToUri(absPath), 'typst');
    }

    /** Full teardown for the workspace page's `onDestroy`. */
    destroy(): void {
        this.wantKey = null;
        this.token++;
        this.teardown();
    }
}

export const lspClient = new LspClientStore();
