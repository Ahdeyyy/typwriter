// The active snippet set: built-ins plus the workspace's own.
//
// User snippets live in `.typwriter/snippets.json` so they travel with the
// project rather than the machine — a thesis and an invoice template want
// different scaffolding, and `.typwriter/` is already where per-project state
// lives.

import {
    BUILTIN_SNIPPETS,
    exampleSnippetFile,
    mergeSnippets,
    parseUserSnippets,
    type Snippet,
} from '$lib/snippets';
import { createFile, readFile, saveFile } from '$lib/ipc/commands';
import { logError } from '$lib/logger';
import { workspace } from '$lib/stores/workspace.svelte';

/** Workspace-relative path of the user's snippet file. */
export const SNIPPETS_REL_PATH = '.typwriter/snippets.json';

class SnippetStore {
    /** Built-ins merged with the user's, sorted by name. */
    all = $state<Snippet[]>([...BUILTIN_SNIPPETS]);

    /** Problems from the last load, for surfacing without blocking anything. */
    errors = $state<string[]>([]);

    /**
     * Reload the user's snippets.
     *
     * A missing file is the normal case, not an error: the built-in set is what
     * most projects will ever use.
     */
    async refresh(): Promise<void> {
        if (!workspace.rootPath) {
            this.all = [...BUILTIN_SNIPPETS];
            this.errors = [];
            return;
        }

        const result = await readFile(workspace.toAbs(SNIPPETS_REL_PATH));
        if (result.isErr()) {
            // No file, or unreadable — fall back to the built-ins silently.
            this.all = [...BUILTIN_SNIPPETS];
            this.errors = [];
            return;
        }

        const response = result.value;
        if (response.type !== 'text') {
            this.all = [...BUILTIN_SNIPPETS];
            this.errors = [];
            return;
        }

        const { snippets, errors } = parseUserSnippets(response.content);
        this.all = mergeSnippets(BUILTIN_SNIPPETS, snippets);
        this.errors = errors;
        for (const error of errors) {
            logError(`snippets: ${error}`);
        }
    }

    /**
     * Ensure `snippets.json` exists and return its relative path, so the caller
     * can open it in a tab. Creating it with an example is friendlier than
     * opening an empty buffer and leaving the format to be guessed.
     */
    async ensureUserFile(): Promise<string | null> {
        if (!workspace.rootPath) return null;
        const abs = workspace.toAbs(SNIPPETS_REL_PATH);

        const existing = await readFile(abs);
        if (existing.isOk() && existing.value.type === 'text') return SNIPPETS_REL_PATH;

        // `create_file` makes the parent directory; `save_file` writes content.
        const created = await createFile(abs);
        if (created.isErr()) {
            logError('snippets: could not create snippets.json:', created.error);
            return null;
        }
        const written = await saveFile(abs, exampleSnippetFile());
        if (written.isErr()) {
            logError('snippets: could not write snippets.json:', written.error);
            return null;
        }
        return SNIPPETS_REL_PATH;
    }

    reset(): void {
        this.all = [...BUILTIN_SNIPPETS];
        this.errors = [];
    }
}

export const snippets = new SnippetStore();
