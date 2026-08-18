// Citation keys from the project's `.bib` files.
//
// Unlike `<labels>`, which live in buffers the user has open, bibliography
// files are usually never opened as tabs — so these have to be read from disk.
// They also change rarely, which is why this is a store refreshed on workspace
// and file-tree changes rather than something the completion path recomputes.

import { parseBibtex, type BibEntry } from '$lib/bibliography';
import { readFile } from '$lib/ipc/commands';
import { logError } from '$lib/logger';
import { workspace, type FileNode } from '$lib/stores/workspace.svelte';

/** Guard against a pathological project. Reading every `.bib` is cheap, but a
 *  tree with hundreds of them is a sign something else is wrong. */
const MAX_FILES = 32;

function collectBibFiles(nodes: readonly FileNode[], out: string[] = []): string[] {
    for (const node of nodes) {
        if (node.is_dir) collectBibFiles(node.children, out);
        else if (node.path.toLowerCase().endsWith('.bib')) out.push(node.path);
    }
    return out;
}

class BibliographyStore {
    entries = $state<BibEntry[]>([]);

    /** Parsed content per path, so an unchanged file is not re-parsed. */
    private cache = new Map<string, { content: string; entries: BibEntry[] }>();
    /** Guards against overlapping refreshes racing to set `entries`. */
    private generation = 0;

    /**
     * Re-read every `.bib` in the workspace.
     *
     * Safe to call often: files whose content is unchanged come back from the
     * cache without being re-parsed, and only the newest call is allowed to
     * publish its result.
     */
    async refresh(): Promise<void> {
        const generation = ++this.generation;
        const paths = collectBibFiles(workspace.tree).slice(0, MAX_FILES);

        const collected: BibEntry[] = [];
        for (const path of paths) {
            const result = await readFile(workspace.toAbs(path));
            if (result.isErr()) {
                // A `.bib` that cannot be read is not worth interrupting the
                // user over — it just contributes no completions.
                logError(`bibliography: could not read ${path}:`, result.error);
                continue;
            }
            const response = result.value;
            if (response.type !== 'text') continue;

            const cached = this.cache.get(path);
            if (cached && cached.content === response.content) {
                collected.push(...cached.entries);
                continue;
            }
            const entries = parseBibtex(response.content, path);
            this.cache.set(path, { content: response.content, entries });
            collected.push(...entries);
        }

        // A refresh started later has already published fresher data.
        if (generation !== this.generation) return;

        for (const path of [...this.cache.keys()]) {
            if (!paths.includes(path)) this.cache.delete(path);
        }
        this.entries = collected;
    }

    clear(): void {
        this.generation++;
        this.cache.clear();
        this.entries = [];
    }
}

export const bibliography = new BibliographyStore();
