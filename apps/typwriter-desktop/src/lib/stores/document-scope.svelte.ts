// Project-wide `<label>` index plus document scope for reference completion.
//
// typst-ide completes neither labels nor citations across files, and open
// tabs alone miss a figure label in a chapter nobody has opened. This scans
// every `.typ` file in the workspace instead, caching per path so unchanged
// files are not re-parsed.
//
// The scan also derives *scope*: which files the main document actually pulls
// in via `#include`/`#import`, and which bibliography files those files pass
// to `#bibliography()`. Only labels from reachable files and citation keys
// from associated bib files are referable — everything else would offer
// completions Typst itself would reject. Both sets may legitimately be empty:
// no reachable `#bibliography` means no citations, full stop. There is no
// fallback-to-everything; an unresolvable graph offers nothing.
//
// Scope follows the *live* text: open buffers are pushed in on every content
// change (`setBuffers`) and take precedence over the disk copy, so removing a
// `#bibliography(...)` or editing a refs array updates the completion list
// while typing. Because recomputes are debounced for background consumers,
// completion queries call `ensureFresh()` to get the scope for the exact
// current text synchronously.

import { SvelteMap, SvelteSet } from 'svelte/reactivity';

import { readFile } from '$lib/ipc/commands';
import { logError } from '$lib/logger';
import {
    computeDocumentScope,
    emptyFacts,
    extractBibliographySources,
    extractImports,
    extractLetValues,
    extractModuleRefs,
    type FileScopeFacts,
} from '$lib/module-graph';
import { extractLabels, type LabelDef } from '$lib/references';
import { workspace, type FileNode } from '$lib/stores/workspace.svelte';

/** Guard against a pathological project; a real book is well under this. */
const MAX_FILES = 512;

/** Files read per IPC round, so a big workspace neither serializes nor floods. */
const BATCH = 8;

/** How long keystrokes may settle before scope recomputes off the new text. */
const RECOMPUTE_DELAY_MS = 200;

function collectTypFiles(nodes: readonly FileNode[], out: string[] = []): string[] {
    for (const node of nodes) {
        if (node.is_dir) collectTypFiles(node.children, out);
        else if (node.path.toLowerCase().endsWith('.typ')) out.push(node.path);
    }
    return out;
}

interface BufferFacts extends FileScopeFacts {
    content: string;
}

class DocumentScopeStore {
    entries = $state<LabelDef[]>([]);

    /** Files the main document pulls in (plus the active file); possibly empty. */
    reachableFiles = $state<SvelteSet<string>>(new SvelteSet());

    /** Bib files passed to `#bibliography()` in main-reachable files;
     *  possibly empty — empty means no citations are referable. */
    scopedBibPaths = $state<SvelteSet<string>>(new SvelteSet());

    /** Parsed facts per path, so an unchanged file is not re-parsed. */
    private cache = new Map<string, { content: string; labels: LabelDef[] } & FileScopeFacts>();
    /** Live buffer texts, layered over `cache`. Memoized per content string. */
    private buffers = new SvelteMap<string, BufferFacts>();
    /** The `.typ` file being edited — seeds scope with its own subgraph. */
    private activeFile: string | null = null;
    /** Guards against overlapping refreshes racing to publish results. */
    private generation = 0;
    private recomputeTimer: ReturnType<typeof setTimeout> | null = null;
    /** Buffer facts newer than the last recompute. */
    private dirty = false;

    /**
     * Re-read every `.typ` in the workspace, then recompute scope.
     *
     * Safe to call often: files whose content is unchanged come back from the
     * cache without being re-parsed, and only the newest call is allowed to
     * publish its result.
     */
    async refresh(): Promise<void> {
        const generation = ++this.generation;
        const paths = collectTypFiles(workspace.tree).slice(0, MAX_FILES);

        const collected: LabelDef[] = [];
        for (let i = 0; i < paths.length; i += BATCH) {
            const batch = paths.slice(i, i + BATCH);
            const settled = await Promise.all(batch.map((path) => this.readDisk(path)));
            // A refresh started later has already taken over; drop our work.
            if (generation !== this.generation) return;
            for (const found of settled) collected.push(...found.labels);
        }

        if (generation !== this.generation) return;

        for (const path of [...this.cache.keys()]) {
            if (!paths.includes(path)) this.cache.delete(path);
        }
        this.entries = collected;
        this.recompute();
    }

    /**
     * Hand over the currently open `.typ` buffers. Their text overrides the
     * disk copy for as long as they stay open — unsaved edits are exactly
     * what the compiler would see.
     *
     * Facts are memoized per content string, so the every-keystroke calls
     * from the editor only re-parse the buffer that actually changed, and an
     * update that changes nothing schedules no recompute at all.
     */
    setBuffers(buffers: readonly { path: string; text: string }[]): void {
        const next = new SvelteMap<string, BufferFacts>();
        let changed = buffers.length !== this.buffers.size;
        for (const buffer of buffers) {
            const prev = this.buffers.get(buffer.path);
            if (prev && prev.content === buffer.text) {
                next.set(buffer.path, prev);
                continue;
            }
            changed = true;
            next.set(buffer.path, {
                content: buffer.text,
                moduleRefs: extractModuleRefs(buffer.text),
                bibSources: extractBibliographySources(buffer.text),
                letValues: extractLetValues(buffer.text),
                imports: extractImports(buffer.text),
            });
        }

        this.buffers = next;
        if (changed) {
            this.dirty = true;
            this.scheduleRecompute();
        }
    }

    /** The `.typ` file being edited seeds scope with its own subgraph, so an
     *  unreachable chapter still offers its own labels while edited. */
    setActiveFile(path: string | null): void {
        if (this.activeFile === path) return;
        this.activeFile = path;
        this.recompute();
    }

    private scheduleRecompute(): void {
        if (this.recomputeTimer) clearTimeout(this.recomputeTimer);
        this.recomputeTimer = setTimeout(() => {
            this.recomputeTimer = null;
            this.recompute();
        }, RECOMPUTE_DELAY_MS);
    }

    /**
     * Bring the published scope up to date with the current buffer text —
     * synchronously when a recompute is pending. Completion sources call this
     * before reading the sets, so an edit to a refs array is reflected by the
     * very next query instead of after the debounce delay.
     */
    ensureFresh(): void {
        if (!this.dirty) return;
        if (this.recomputeTimer) {
            clearTimeout(this.recomputeTimer);
            this.recomputeTimer = null;
        }
        this.recompute();
    }

    /**
     * Recompute scope — no IPC. Facts resolve to open buffers first, then the
     * disk scan's cache.
     */
    recompute(): void {
        const scope = computeDocumentScope(
            workspace.mainFile,
            (path) => {
                const buffered = this.buffers.get(path);
                if (buffered) return buffered;
                const cached = this.cache.get(path);
                return cached
                    ? { ...cached }
                    : null;
            },
            this.activeFile ? [this.activeFile] : []
        );
        this.dirty = false;

        this.reachableFiles = new SvelteSet(scope.reachableFiles);
        this.scopedBibPaths = new SvelteSet(scope.scopedBibPaths);
    }

    private async readDisk(
        path: string
    ): Promise<{ labels: LabelDef[] } & FileScopeFacts> {
        const cached = this.cache.get(path);
        const result = await readFile(workspace.toAbs(path));
        if (result.isErr()) {
            // An unreadable file just contributes no completions.
            logError(`document-scope: could not read ${path}:`, result.error);
            return cached ?? { labels: [], ...emptyFacts() };
        }
        const response = result.value;
        if (response.type !== 'text') {
            return cached ?? { labels: [], ...emptyFacts() };
        }
        if (cached && cached.content === response.content) return cached;

        const facts = {
            content: response.content,
            labels: extractLabels(response.content, path),
            moduleRefs: extractModuleRefs(response.content),
            bibSources: extractBibliographySources(response.content),
            letValues: extractLetValues(response.content),
            imports: extractImports(response.content),
        };
        this.cache.set(path, facts);
        return facts;
    }

    clear(): void {
        this.generation++;
        if (this.recomputeTimer) {
            clearTimeout(this.recomputeTimer);
            this.recomputeTimer = null;
        }
        this.cache.clear();
        this.buffers.clear();
        this.activeFile = null;
        this.dirty = false;
        this.entries = [];
        this.reachableFiles = new SvelteSet();
        this.scopedBibPaths = new SvelteSet();
    }
}

export const documentScope = new DocumentScopeStore();
