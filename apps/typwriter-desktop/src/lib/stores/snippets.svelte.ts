// The active snippet set, layered from three sources.
//
//   builtin  ships with the app
//   app      follows the user across every project (app settings)
//   project  lives in `.typwriter/snippets.json` and travels with the document
//
// More specific wins, so one project can disagree with the user's global set,
// and the global set can disagree with the built-ins. Both writable scopes are
// editable in-app; nobody has to hand-edit JSON, though the project file stays
// plain JSON so it can be reviewed and committed like any other project asset.
//
// Every window keeps its own instance of this store, and the two that matter
// are different windows: snippets are authored in the settings window and
// consumed by the completion list in the main one. So each write broadcasts
// `snippets:changed` and each store reloads the named scope on hearing it —
// see `initSync`.

import {
    BUILTIN_SNIPPETS,
    parseUserSnippets,
    removeSnippet,
    resolveSnippets,
    serializeSnippets,
    SNIPPETS_REL_PATH,
    upsertSnippet,
    type ResolvedSnippet,
    type Snippet,
    type SnippetScope,
} from '$lib/snippets';
import {
    getProjectSnippets,
    getUserSnippets,
    setProjectSnippets,
    setUserSnippets,
} from '$lib/ipc/commands';
import {
    emitSnippetsChanged,
    onSnippetsChanged,
    type SnippetScopeChanged,
    type UnlistenFn,
} from '$lib/ipc/events';
import { logError } from '$lib/logger';
import { workspace } from '$lib/stores/workspace.svelte';

/** Scopes a user can actually write to. */
export type WritableScope = Exclude<SnippetScope, 'builtin'>;

class SnippetStore {
    /** Editable app-wide set. */
    appSnippets = $state<Snippet[]>([]);
    /** Editable project set, empty when no workspace is open. */
    projectSnippets = $state<Snippet[]>([]);

    /** Problems from the last project-file parse, surfaced in the editor. */
    errors = $state<string[]>([]);

    private appLoaded = false;
    private syncUnlisten: UnlistenFn | null = null;

    /** The layered set the completion source consumes. */
    all = $derived<ResolvedSnippet[]>(
        resolveSnippets(BUILTIN_SNIPPETS, this.appSnippets, this.projectSnippets)
    );

    /** Whether a project file can be written at all. */
    get hasProject(): boolean {
        return !!workspace.rootPath;
    }

    snippetsIn(scope: WritableScope): Snippet[] {
        return scope === 'app' ? this.appSnippets : this.projectSnippets;
    }

    // ── Loading ───────────────────────────────────────────────────────────────

    /**
     * Start replaying other windows' snippet edits into this store.
     *
     * Called once per window from the root layout. Receivers reload from
     * storage rather than applying the payload, so the two scopes' files stay
     * the single source of truth, and they never re-emit, so there is no
     * ping-pong.
     */
    async initSync(): Promise<void> {
        if (this.syncUnlisten) return;
        const result = await onSnippetsChanged((scope) => {
            void this.reloadScope(scope);
        });
        result.match(
            (unlisten) => {
                this.syncUnlisten = unlisten;
            },
            (err) => logError('snippets: sync listener failed:', err)
        );
    }

    private async reloadScope(scope: SnippetScopeChanged): Promise<void> {
        if (scope === 'app') {
            // `loadApp` is a one-shot; this is a deliberate re-read.
            this.appLoaded = false;
            await this.loadApp();
            return;
        }
        await this.refreshProject();
    }

    /** Load the app-wide set. Idempotent; safe to call from several places. */
    async loadApp(): Promise<void> {
        if (this.appLoaded) return;
        this.appLoaded = true;
        const result = await getUserSnippets();
        result.match(
            (value) => {
                // Stored as JSON by us, but validated on the way back in — it
                // may have been written by another version.
                const { snippets } = parseUserSnippets(JSON.stringify(value ?? []));
                this.appSnippets = snippets;
            },
            (err) => {
                logError('snippets: loading app-wide set failed:', err);
                this.appSnippets = [];
            }
        );
    }

    /**
     * Reload the project set.
     *
     * A missing file is the normal case, not an error: most projects will only
     * ever use the built-ins. Rust resolves the path against the open
     * workspace, so this works from any window — including the settings
     * window, which has no workspace of its own.
     */
    async refreshProject(): Promise<void> {
        const result = await getProjectSnippets();
        if (result.isErr()) {
            logError('snippets: reading the project set failed:', result.error);
            return;
        }

        const contents = result.value;
        if (contents === null) {
            this.projectSnippets = [];
            this.errors = [];
            return;
        }

        const { snippets, errors } = parseUserSnippets(contents);
        this.projectSnippets = snippets;
        this.errors = errors;
        for (const error of errors) logError(`snippets: ${error}`);
    }

    /** Reload both scopes. What the file tree and the palette command call. */
    async refresh(): Promise<void> {
        await this.loadApp();
        await this.refreshProject();
    }

    // ── Writing ───────────────────────────────────────────────────────────────

    /** Create or update a snippet in `scope`, renaming in place if asked. */
    async save(scope: WritableScope, snippet: Snippet, replacing?: string): Promise<void> {
        if (scope === 'app') {
            this.appSnippets = upsertSnippet(this.appSnippets, snippet, replacing);
            await this.persistApp();
            return;
        }
        this.projectSnippets = upsertSnippet(this.projectSnippets, snippet, replacing);
        await this.persistProject();
    }

    async remove(scope: WritableScope, name: string): Promise<void> {
        if (scope === 'app') {
            this.appSnippets = removeSnippet(this.appSnippets, name);
            await this.persistApp();
            return;
        }
        this.projectSnippets = removeSnippet(this.projectSnippets, name);
        await this.persistProject();
    }

    /**
     * Copy a snippet into the other writable scope.
     *
     * The move people actually want: "this project snippet turned out to be
     * generally useful", or "start from the global one and tweak it here".
     */
    async copyTo(scope: WritableScope, snippet: Snippet): Promise<void> {
        const { scope: _scope, overrides: _overrides, ...plain } = snippet as ResolvedSnippet;
        await this.save(scope, plain);
    }

    private async persistApp(): Promise<void> {
        const result = await setUserSnippets(this.appSnippets);
        result.match(
            () => void emitSnippetsChanged('app'),
            (err) => logError('snippets: saving app-wide set failed:', err)
        );
    }

    /**
     * Write `.typwriter/snippets.json`.
     *
     * Written even when the list is empty, so deleting the last project snippet
     * is durable rather than silently reverting on the next load.
     */
    private async persistProject(): Promise<void> {
        const result = await setProjectSnippets(serializeSnippets(this.projectSnippets));
        result.match(
            () => void emitSnippetsChanged('project'),
            (err) => logError('snippets: writing snippets.json failed:', err)
        );
    }

    /** Path of the project file, creating it if needed, for opening in a tab. */
    async ensureProjectFile(): Promise<string | null> {
        if (!workspace.rootPath) return null;
        await this.persistProject();
        return SNIPPETS_REL_PATH;
    }

    reset(): void {
        this.projectSnippets = [];
        this.errors = [];
    }
}

export const snippets = new SnippetStore();
