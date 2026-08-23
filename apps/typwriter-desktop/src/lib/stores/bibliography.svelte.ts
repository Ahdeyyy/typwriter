// Citation keys from the project's bibliography files.
//
// Typst reads BibTeX (`.bib`) and Hayagriva YAML (`.yml`/`.yaml`); parsing
// happens in Rust (`parse_bibliography`) with the compiler's own hayagriva
// library, so a file Typst accepts is exactly a file completions can serve.
//
// Unlike `<labels>`, which live in buffers the user has open, bibliography
// files are usually never opened as tabs — so these have to be read from disk.
// They also change rarely, which is why this is a store refreshed on workspace
// and file-tree changes rather than something the completion path recomputes.

import type { BibEntry } from '$lib/bibliography';
import { parseBibliography } from '$lib/ipc/commands';
import { logError } from '$lib/logger';
import { workspace, type FileNode } from '$lib/stores/workspace.svelte';

/** Guard against a pathological project. Reading every file is cheap, but a
 *  tree with hundreds of them is a sign something else is wrong. */
const MAX_FILES = 32;

const HAYAGRIVA_EXTENSIONS = ['.yml', '.yaml'];

function isBibPath(path: string): boolean {
    return path.toLowerCase().endsWith('.bib');
}

function isBibliographyPath(path: string): boolean {
    const lower = path.toLowerCase();
    return (
        isBibPath(lower) || HAYAGRIVA_EXTENSIONS.some((ext) => lower.endsWith(ext))
    );
}

function collectBibFiles(nodes: readonly FileNode[], out: string[] = []): string[] {
    for (const node of nodes) {
        if (node.is_dir) collectBibFiles(node.children, out);
        else if (isBibliographyPath(node.path)) out.push(node.path);
    }
    return out;
}

class BibliographyStore {
    entries = $state<BibEntry[]>([]);

    /** Guards against overlapping refreshes racing to set `entries`. */
    private generation = 0;

    /**
     * Re-read every bibliography file in the workspace.
     *
     * Safe to call often: only the newest call publishes its result.
     */
    async refresh(): Promise<void> {
        const generation = ++this.generation;
        const paths = collectBibFiles(workspace.tree).slice(0, MAX_FILES);

        const settled = await Promise.all(paths.map((path) => this.readEntries(path)));
        // A refresh started later has already published fresher data.
        if (generation !== this.generation) return;

        this.entries = settled.flat();
    }

    /** A file that cannot be read or parsed just contributes no completions;
     *  the failure is logged because silent gaps are miserable to debug. */
    private async readEntries(path: string): Promise<BibEntry[]> {
        const result = await parseBibliography(workspace.toAbs(path));
        if (result.isErr()) {
            logError(`bibliography: could not read ${path}:`, result.error);
            return [];
        }
        return result.value.map((entry) => ({
            key: entry.key,
            type: entry.entryType,
            title: entry.title ?? undefined,
            author: entry.author ?? undefined,
            year: entry.year ?? undefined,
            path,
            // Line numbers came from the old TS reader's offset tracking;
            // nothing displays them for citations.
            line: 0,
        }));
    }

    clear(): void {
        this.generation++;
        this.entries = [];
    }
}

export const bibliography = new BibliographyStore();
