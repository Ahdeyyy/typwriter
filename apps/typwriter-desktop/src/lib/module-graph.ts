// The include/import graph of a Typst project.
//
// A label is only referable from a document that actually pulls the file
// defining it in — a chapter nobody includes contributes nothing to the
// compiled output, so offering its labels in completion would be wrong.
// Starting from the workspace's main file and walking `#include`/`#import`
// edges yields exactly the files whose labels (and `#bibliography()` calls)
// are available to the document being typed in.
//
// Extraction goes through the grammar, like label extraction: paths inside
// comments or raw blocks are ignored. Resolution follows Typst's own rules —
// relative to the file containing the call, or workspace-root-relative with a
// leading `/`.

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';
import { dirname, normalize } from '$lib/paths';
import type { SyntaxNode } from '@lezer/common';

/** The quoted string inside a `Str` node's text, unescaped. */
function strValue(raw: string): string {
    const inner =
        raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
            ? raw.slice(1, -1)
            : raw;
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Resolve a module path as Typst would: `/chapters/a.typ` from the workspace
 * root, anything else relative to the directory of `fromFile`.
 *
 * Returns null for paths that cannot point at a Typst module (`""`, external
 * packages `@preview/…`). The `.typ` extension itself is not appended —
 * Typst requires it (or a full filename) in the source.
 */
export function resolveModulePath(fromFile: string, raw: string): string | null {
    const target = raw.trim();
    if (!target || target.startsWith('@')) return null;

    const base = dirname(fromFile);
    const resolved = target.startsWith('/')
        ? normalize(target.slice(1))
        : normalize(base ? `${base}/${target}` : target);
    // `..` climbing out of the workspace can never name a project file.
    return resolved.split('/').includes('..') ? null : resolved;
}

/** A source argument as written: either a literal string or an identifier
 *  that has to be resolved through `#let` bindings / imports. */
export interface SourceRef {
    kind: 'str' | 'ident';
    value: string;
}

/** One imported binding: `#import "f.typ": a as b` → name "a", local "b".
 *  A star import (`: *`) is recorded with name null. */
export interface ImportEntry {
    module: string;
    name: string | null;
    local: string;
}

/** Everything scope computation needs to know about one file. Sources are
 *  kept *unresolved* — identifiers become strings only during scope
 *  computation, which sees the whole graph and can follow imports. */
export interface FileScopeFacts {
    moduleRefs: SourceRef[];
    bibSources: SourceRef[];
    /** Top-level-ish `#let` bindings whose value is a string or array of
     *  strings: the only shapes static resolution can see through. */
    letValues: Record<string, string[]>;
    imports: ImportEntry[];
}

export function emptyFacts(): FileScopeFacts {
    return { moduleRefs: [], bibSources: [], letValues: {}, imports: [] };
}

/** First source expression of a module statement: the `Str` or, for
 *  variable-indirect includes (`#include chapterFile`), the `Ident`. */
function firstSourceExpr(node: SyntaxNode, text: string): SourceRef | null {
    // The source expression precedes any import items, so the first `Str` or
    // `Ident` sibling after the keyword is it.
    for (let child = node.firstChild; child; child = child.nextSibling) {
        const name = child.type.name;
        if (name === 'Str') return { kind: 'str', value: strValue(text.slice(child.from, child.to)) };
        if (name === 'Ident') return { kind: 'ident', value: text.slice(child.from, child.to) };
    }
    return null;
}

/** Module paths referenced by `#include …` / `#import …`, unresolved. */
export function extractModuleRefs(text: string): SourceRef[] {
    if (!text) return [];
    const tree = parser.parse(text);
    const refs: SourceRef[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'ModuleImport' && node.name !== 'ModuleInclude') return;
            const ref = firstSourceExpr(node.node, text);
            if (ref) refs.push(ref);
        },
    });
    return refs;
}

/** Positional arguments of an argument list; named args are skipped so a
 *  `style: "ieee"` never masquerades as a bibliography source. */
function collectPositionalArgs(args: SyntaxNode, text: string): SourceRef[] {
    const out: SourceRef[] = [];
    for (let child = args.firstChild; child; child = child.nextSibling) {
        const name = child.type.name;
        if (name === 'Named') continue;
        if (name === 'Str') {
            out.push({ kind: 'str', value: strValue(text.slice(child.from, child.to)) });
            continue;
        }
        if (name === 'Ident') {
            out.push({ kind: 'ident', value: text.slice(child.from, child.to) });
            continue;
        }
        // Array form: #bibliography(("a.bib", refs)).
        if (name === 'Array' || name === 'Parenthesized') {
            for (let item = child.firstChild; item; item = item.nextSibling) {
                const itemName = item.type.name;
                if (itemName === 'Str') {
                    out.push({ kind: 'str', value: strValue(text.slice(item.from, item.to)) });
                } else if (itemName === 'Ident') {
                    out.push({ kind: 'ident', value: text.slice(item.from, item.to) });
                }
            }
        }
    }
    return out;
}

/** Bibliography sources of every `#bibliography(…)` call in the text,
 *  including identifier arguments awaiting resolution. */
export function extractBibliographySources(text: string): SourceRef[] {
    if (!text) return [];
    const tree = parser.parse(text);
    const sources: SourceRef[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'FuncCall') return;
            // The call target: `#bibliography(...)` puts a `Hash` marker
            // before the identifier, so look for the `Ident` specifically.
            const callee = node.node.getChild('Ident');
            if (!callee) return;
            if (text.slice(callee.from, callee.to) !== 'bibliography') return;
            const args = node.node.getChild('Args');
            if (args) sources.push(...collectPositionalArgs(args, text));
        },
    });
    return sources;
}

/**
 * `#let` bindings whose value is a string or array-of-strings literal — the
 * only shapes static resolution can see through. Captured regardless of
 * nesting; a later binding shadows an earlier one (last wins).
 */
export function extractLetValues(text: string): Record<string, string[]> {
    if (!text) return {};
    const tree = parser.parse(text);
    const out: Record<string, string[]> = {};

    /** Literal values of an expression node: `Str` → one value,
     *  `Parenthesized`/`Array` → each direct `Str`; anything else → null. */
    const literalValues = (node: SyntaxNode): string[] | null => {
        if (node.type.name === 'Str') return [strValue(text.slice(node.from, node.to))];
        if (node.type.name === 'Parenthesized' || node.type.name === 'Array') {
            const values: string[] = [];
            for (let item = node.firstChild; item; item = item.nextSibling) {
                const kind = item.type.name;
                // Separators are structural noise; a non-string *element*
                // makes the whole array opaque.
                if (kind === 'Str') {
                    values.push(strValue(text.slice(item.from, item.to)));
                } else if (
                    kind !== 'Comma' &&
                    kind !== 'LeftParen' &&
                    kind !== 'RightParen'
                ) {
                    return null;
                }
            }
            return values;
        }
        return null;
    };

    tree.iterate({
        enter(node) {
            if (node.name !== 'LetBinding') return;
            // Children: Hash, Let, Ident(name) [, Params], Eq, value.
            let name: string | null = null;
            let valueNode: SyntaxNode | null = null;
            let sawEq = false;
            for (
                let child = node.node.firstChild;
                child && !valueNode;
                child = child.nextSibling
            ) {
                const kind = child.type.name;
                if (!name && kind === 'Ident') {
                    name = text.slice(child.from, child.to);
                    continue;
                }
                // `let f(x) = …` has params between the name and the `=`.
                if (kind === 'Params') continue;
                if (kind === 'Eq') {
                    sawEq = true;
                    valueNode = child.nextSibling;
                }
            }
            if (!name || !sawEq || !valueNode) return;
            const values = literalValues(valueNode);
            if (values) out[name] = values;
        },
    });
    return out;
}

/** Imported bindings of the file's `#import "…" : …` statements. A plain
 *  module import (`#import "f.typ"`) is not recorded — its namespace would
 *  need field access to use. */
export function extractImports(text: string): ImportEntry[] {
    if (!text) return [];
    const tree = parser.parse(text);
    const imports: ImportEntry[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'ModuleImport') return;
            const source = firstSourceExpr(node.node, text);
            if (!source || source.kind !== 'str') return;

            let afterColon = false;
            let pendingName: string | null = null;
            let expectAlias = false;
            const flushPending = () => {
                if (pendingName !== null) {
                    imports.push({
                        module: source.value,
                        name: pendingName,
                        local: pendingName,
                    });
                    pendingName = null;
                }
            };
            for (
                let child = node.node.firstChild;
                child;
                child = child.nextSibling
            ) {
                const name = child.type.name;
                if (name === 'Colon') {
                    afterColon = true;
                    continue;
                }
                if (!afterColon) continue;
                switch (name) {
                    case 'Star':
                        imports.push({ module: source.value, name: null, local: '*' });
                        return;
                    case 'As':
                        expectAlias = true;
                        continue;
                    case 'Comma':
                        // Items are comma-separated; a bare item ends here.
                        flushPending();
                        continue;
                    case 'Ident':
                        break;
                    default:
                        continue;
                }
                const id = text.slice(child.from, child.to);
                if (pendingName === null) {
                    pendingName = id;
                } else if (expectAlias) {
                    imports.push({ module: source.value, name: pendingName, local: id });
                    pendingName = null;
                    expectAlias = false;
                } else {
                    // Next item of the list — the previous one was complete.
                    flushPending();
                    pendingName = id;
                }
            }
            flushPending();
        },
    });
    return imports;
}

/** The availability picture for a document: which files contribute labels,
 *  and which bibliography files feed `#cite`. Both sets are always plain
 *  sets — possibly empty. Empty means nothing is referable, which is the
 *  honest answer when the graph cannot be resolved: offering completions the
 *  compiler would reject helps nobody. */
export interface DocumentScope {
    reachableFiles: Set<string>;
    scopedBibPaths: Set<string>;
}

/**
 * Compute the document's scope from per-file facts.
 *
 * `factsFor` is the lookup layer — open buffers, disk cache, whatever the
 * caller layers up. The BFS starts at `mainFile` plus `extraSeeds` (the file
 * currently being edited, so an unreachable chapter still offers its own
 * labels while you are in it). Citations come only from `#bibliography`
 * calls in main-reachable files — an unreachable file's own bibliographies
 * do not feed global citation scope.
 */
export function computeDocumentScope(
    mainFile: string | null,
    factsFor: (path: string) => FileScopeFacts | null,
    extraSeeds: readonly string[] = []
): DocumentScope {
    // Identifier resolution: a name in `file` comes from its own `#let`
    // bindings, or from an import — which itself may be a re-export from yet
    // another file. Memoized per (file, name); the visiting set breaks cycles.
    const resolveName = (
        file: string,
        name: string,
        visiting: Set<string>
    ): string[] | null => {
        const key = `${file}::${name}`;
        if (visiting.has(key)) return [];
        visiting.add(key);
        try {
            const facts = factsFor(file);
            if (!facts) return null;
            const own = facts.letValues[name];
            if (own) return own;

            let matched = false;
            const values: string[] = [];
            for (const entry of facts.imports) {
                const isCandidate =
                    entry.name === null /* star */ || entry.local === name;
                if (!isCandidate) continue;
                const target = resolveModulePath(file, entry.module);
                if (!target) continue;
                const inner = resolveName(
                    target,
                    entry.name ?? name,
                    visiting
                );
                if (inner) {
                    matched = true;
                    values.push(...inner);
                }
            }
            return matched ? values : null;
        } finally {
            visiting.delete(key);
        }
    };

    /** Resolved raw source strings for one kind of reference, per file. */
    const resolveArgs = (
        file: string,
        args: SourceRef[],
        memo: Map<string, string[]>
    ): string[] => {
        const cached = memo.get(file);
        if (cached) return cached;
        memo.set(file, []); // cycle guard while resolving
        const out: string[] = [];
        const visiting = new Set<string>();
        for (const arg of args) {
            if (arg.kind === 'str') {
                out.push(arg.value);
                continue;
            }
            const values = resolveName(file, arg.value, visiting);
            if (values) out.push(...values);
        }
        memo.set(file, out);
        return out;
    };

    const modMemo = new Map<string, string[]>();
    const bibMemo = new Map<string, string[]>();
    const moduleTargets = (file: string): string[] =>
        resolveArgs(file, factsFor(file)?.moduleRefs ?? [], modMemo)
            .map((raw) => resolveModulePath(file, raw))
            .filter((path): path is string => path !== null);

    /** Every file transitively reachable from `root` through its facts. */
    const componentFrom = (root: string): Set<string> => {
        const seen = new Set<string>();
        if (!factsFor(root)) {
            // Unknown facts contribute the root alone.
            return new Set([root]);
        }
        const queue = [root];
        while (queue.length > 0) {
            const current = queue.pop()!;
            if (seen.has(current)) continue;
            seen.add(current);
            for (const target of moduleTargets(current)) {
                if (!seen.has(target)) queue.push(target);
            }
        }
        return seen;
    };

    const reachable = new Set<string>();
    for (const seed of [
        ...(mainFile && factsFor(mainFile) ? [mainFile] : []),
        ...extraSeeds,
    ]) {
        for (const path of componentFrom(seed)) reachable.add(path);
    }

    const bibs = new Set<string>();
    if (mainFile && factsFor(mainFile)) {
        for (const path of componentFrom(mainFile)) {
            const facts = factsFor(path);
            if (!facts) continue;
            for (const raw of resolveArgs(path, facts.bibSources, bibMemo)) {
                const resolved = resolveModulePath(path, raw);
                if (resolved) bibs.add(resolved);
            }
        }
    }

    return { reachableFiles: reachable, scopedBibPaths: bibs };
}
