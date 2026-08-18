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

import {
    BUILTIN_SNIPPETS,
    parseUserSnippets,
    removeSnippet,
    resolveSnippets,
    serializeSnippets,
    upsertSnippet,
    type ResolvedSnippet,
    type Snippet,
    type SnippetScope,
} from '$lib/snippets';
import {
    createFile,
    getUserSnippets,
    readFile,
    saveFile,
    setUserSnippets,
} from '$lib/ipc/commands';
import { logError } from '$lib/logger';
import { workspace } from '$lib/stores/workspace.svelte';

/** Workspace-relative path of the project snippet file. */
export const SNIPPETS_REL_PATH = '.typwriter/snippets.json';

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
     * ever use the built-ins.
     */
    async refresh(): Promise<void> {
        await this.loadApp();

        if (!workspace.rootPath) {
            this.projectSnippets = [];
            this.errors = [];
            return;
        }

        const result = await readFile(workspace.toAbs(SNIPPETS_REL_PATH));
        if (result.isErr() || result.value.type !== 'text') {
            this.projectSnippets = [];
            this.errors = [];
            return;
        }

        const { snippets, errors } = parseUserSnippets(result.value.content);
        this.projectSnippets = snippets;
        this.errors = errors;
        for (const error of errors) logError(`snippets: ${error}`);
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
        result.mapErr((err) => logError('snippets: saving app-wide set failed:', err));
    }

    /**
     * Write `.typwriter/snippets.json`.
     *
     * Written even when the list is empty, so deleting the last project snippet
     * is durable rather than silently reverting on the next load.
     */
    private async persistProject(): Promise<void> {
        if (!workspace.rootPath) return;
        const abs = workspace.toAbs(SNIPPETS_REL_PATH);

        // `create_file` also makes the parent directory. Harmless if the file
        // already exists; the write below is what carries the content.
        const existing = await readFile(abs);
        if (existing.isErr()) {
            const created = await createFile(abs);
            if (created.isErr()) {
                logError('snippets: could not create snippets.json:', created.error);
                return;
            }
        }

        const written = await saveFile(abs, serializeSnippets(this.projectSnippets));
        written.mapErr((err) => logError('snippets: writing snippets.json failed:', err));
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
