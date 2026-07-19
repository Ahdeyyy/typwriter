// client.svelte.ts — tinymist language-server lifecycle.
//
// Owns the `@codemirror/lsp-client` `LSPClient`, its transport, and the
// spawn/handshake/teardown state machine. The editor asks this store for a
// per-file CodeMirror extension (`pluginFor`); when tinymist isn't active it
// returns `null` and the editor falls back to the typst-ide IPC path.

import {
    LSPClient,
    serverCompletion,
    hoverTooltips,
    signatureHelp,
    serverDiagnostics,
    jumpToDefinitionKeymap,
    renameKeymap,
    findReferencesKeymap,
} from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
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
// need a leading slash before a Windows drive letter (`file:///C:/a`). Drive
// letters are normalized to upper case on both sides so URIs and paths compare
// consistently with the app's own paths (workspace.toRel is case-sensitive).

export function pathToUri(path: string): string {
    let p = path;
    if (/^[a-z]:\//.test(p)) p = p[0].toUpperCase() + p.slice(1);
    const withSlash = p.startsWith('/') ? p : `/${p}`;
    return `file://${encodeURI(withSlash)}`;
}

export function uriToPath(uri: string): string {
    let path = uri.replace(/^file:\/\//, '');
    // Servers may percent-encode reserved characters (VS Code emits
    // `file:///c%3A/...`); `decodeURIComponent` decodes `%3A` where `decodeURI`
    // would not. Safe here: a file URI path has no query/fragment semantics.
    try {
        path = decodeURIComponent(path);
    } catch {
        /* malformed escape — keep the raw path */
    }
    // `/C:/a` or `/c:/a` → `C:/a`
    const m = /^\/([A-Za-z]):\//.exec(path);
    if (m) path = `${m[1].toUpperCase()}:${path.slice(3)}`;
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
 *  is filled in by the caller. Information/Hint diagnostics are dropped — the
 *  pane only has error/warning buckets and lints would inflate the warning
 *  count; the in-editor diagnostics (`serverDiagnostics`) still show them. */
export function toSerializedDiagnostics(lspDiags: LspDiagnostic[]): SerializedDiagnostic[] {
    return lspDiags
        .filter((d) => d.severity === undefined || d.severity <= 2)
        .map((d) => ({
            severity: d.severity === 1 ? ('error' as const) : ('warning' as const),
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
    // All lifecycle transitions (teardown → connect) run serialized through this
    // chain so a superseded flow can never stop the process a newer flow owns:
    // the Rust side holds exactly one tinymist child, and only the transition
    // currently at the head of the chain may start or stop it.
    private chain: Promise<void> = Promise.resolve();

    private enqueue(f: () => Promise<void>): void {
        this.chain = this.chain.then(f).catch(() => {});
    }

    /** Re-run on every change of the `useLsp` setting or the workspace root.
     *  Idempotent: tears down and reconnects only when the desired state or root
     *  actually changed. */
    reconcile(enabled: boolean, root: string | null): void {
        const desired = enabled && !platform.isMobile && !!root;
        const wantKey = desired && root ? pathToUri(root) : null;
        if (wantKey === this.wantKey) return;

        this.wantKey = wantKey;
        const myToken = ++this.token;
        this.enqueue(async () => {
            await this.teardown();
            if (myToken !== this.token) return;
            if (wantKey && root) await this.connect(root, myToken, 0);
        });
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
        // Superseded flows never stop the process — the transition that
        // superseded them runs `teardown` (in the chain) and owns the shutdown.
        if (myToken !== this.token) return;

        const rootUri = pathToUri(root);

        let transport: TauriLspTransport;
        try {
            transport = await createTauriLspTransport();
        } catch (err) {
            logError('lsp transport setup failed:', err);
            if (myToken === this.token) {
                await lspStop();
                this.retryOrFallback(root, myToken, attempt);
            }
            return;
        }
        if (myToken !== this.token) {
            transport.dispose();
            return;
        }

        // Last published diagnostics per URI, for dropping no-op republishes:
        // every `setDiagnostics` dispatch closes an open lint hover tooltip, and
        // tinymist republishes identical diagnostics on each of its compiles.
        const lastPublished = new Map<string, string>();
        const client = new LSPClient({
            rootUri,
            // The deprecated `languageServerExtensions()` bundle also binds
            // `formatKeymap` (Shift-Alt-f), which would shadow the app's own
            // typstyle formatter binding — list the extensions explicitly and
            // leave formatting to the app.
            extensions: [
                serverCompletion(),
                hoverTooltips(),
                signatureHelp(),
                serverDiagnostics(),
                keymap.of([...jumpToDefinitionKeymap, ...renameKeymap, ...findReferencesKeymap]),
            ],
            notificationHandlers: {
                'textDocument/publishDiagnostics': (_client, params) => {
                    // Mirror into the store so the diagnostics *pane* (which reads
                    // the store, not any one editor view) stays in sync. Return
                    // `false` so `serverDiagnostics` still renders the in-editor
                    // diagnostics (underlines + inline messages).
                    const relPath = workspace.toRel(uriToPath(params.uri));
                    diagnostics.setLspDiagnostics(
                        relPath,
                        toSerializedDiagnostics(params.diagnostics ?? []),
                    );
                    // Identical republish: return `true` (handled) so
                    // `serverDiagnostics` doesn't re-dispatch and yank away an
                    // open hover tooltip.
                    const fingerprint = JSON.stringify(params.diagnostics ?? []);
                    if (lastPublished.get(params.uri) === fingerprint) return true;
                    lastPublished.set(params.uri, fingerprint);
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
            if (!initialized && myToken === this.token) {
                // Still the current flow, so it owns the process: stop it before
                // scheduling the retry.
                await lspStop();
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
            if (this.wantKey === rootUri) {
                // scheduleConnect's fire enqueues teardown → connect.
                this.scheduleConnect(root, reconnectToken, 0, RECONNECT_DELAY_MS);
            } else {
                this.enqueue(() => this.teardown());
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
            this.enqueue(async () => {
                await this.teardown();
                if (myToken !== this.token) return;
                await this.connect(root, myToken, attempt);
            });
        }, delayMs);
    }

    private clearRetryTimer(): void {
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    /** The single place the tinymist process is stopped. Always awaits the stop
     *  so the next transition in the chain observes a fully-dead process — a
     *  `start` invoke can otherwise race a fire-and-forget `stop` server-side. */
    private async teardown(): Promise<void> {
        // Cancel any pending backoff so a superseded flow can't reconnect.
        this.clearRetryTimer();
        // Drop the closed-listener first so killing the child doesn't re-trigger it.
        if (this.closedUnlisten) {
            this.closedUnlisten();
            this.closedUnlisten = null;
        }
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
        await lspStop();
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
        this.enqueue(() => this.teardown());
    }
}

export const lspClient = new LspClientStore();
