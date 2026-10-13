import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';
import { citePrefixAt, refPrefixAt } from '$lib/references';

export type CompletionScope = 'markup' | 'code' | 'string' | 'raw' | 'raw-language' | 'comment' | 'math' | 'reference';

const trees = new WeakMap<EditorState, Tree>();

/** Recovery can consume comment trivia without adding it to the tree. Only
 * scan the gap after the last parsed child, so strings and raw text are excluded. */
function commentInGap(text: string, pos: number, node: SyntaxNode): boolean {
    if (!node.firstChild) return false;
    const from = node.childBefore(pos)?.to ?? node.from;
    let depth = 0;
    let line = false;
    for (const token of text.slice(from, pos).matchAll(/\/\*|\*\/|\/\/|[\r\n]/g)) {
        if (line) {
            if (token[0] === '\r' || token[0] === '\n') line = false;
        } else if (token[0] === '/*') depth++;
        else if (depth && token[0] === '*/') depth--;
        else if (!depth && token[0] === '//') line = true;
    }
    return line || depth > 0;
}

/** Reuse the editor's outer Typst tree, including around mounted raw languages. */
export function completionTree(state: EditorState): Tree {
    const tree = syntaxTree(state);
    if (tree.topNode.name === 'Document' && tree.length === state.doc.length) return tree;
    let fallback = trees.get(state);
    if (!fallback) {
        fallback = parser.parse(state.doc.toString());
        trees.set(state, fallback);
    }
    return fallback;
}

/** The innermost language context wins: content inside a code call is markup. */
export function completionScope(text: string, pos: number, tree = parser.parse(text)): CompletionScope {
    for (let node: SyntaxNode | null = tree.resolve(pos, -1); node; node = node.parent) {
        if (node.name === 'LineComment') return 'comment';
        if (node.name === 'BlockComment') {
            if (pos === node.to && text.slice(node.to - 2, node.to) === '*/') continue;
            return 'comment';
        }
        if (node.name === 'Raw') {
            const open = node.firstChild;
            const lang = open?.nextSibling;
            if (open && open.to - open.from >= 3 && pos >= open.to &&
                pos <= (lang?.name === 'RawLang' ? lang.to : open.to)) return 'raw-language';
            const close = node.lastChild;
            if (pos === node.to && close?.name === 'RawDelim' && close.from > node.from) continue;
            return 'raw';
        }
        if (node.name === 'Str' || node.name === 'StrContent') return 'string';
        if (commentInGap(text, pos, node)) return 'comment';
        // An unfinished field access can be a markup Text node beside code.
        if (node.name === 'Text' && node.prevSibling?.type.is('Code') &&
            /^\.[\p{L}\p{M}\p{N}_-]*$/u.test(text.slice(node.from, pos))) return 'code';
        if (node.name === 'ContentBlock' || node.name === 'Document') return 'markup';
        if (node.name === 'Equation' || node.type.is('Math')) return 'math';
        if (node.name === 'Ref' || node.name === 'Label') return 'reference';
        if (node.type.is('Code')) return 'code';
        if (node.name === 'Link') return 'raw';
    }
    return 'markup';
}

export function referenceContextAt(state: EditorState, pos: number) {
    const text = state.doc.toString();
    const tree = completionTree(state);
    const scope = completionScope(text, pos, tree);
    let ref = scope === 'markup' || scope === 'reference' ? refPrefixAt(text, pos) : null;
    if (ref && tree.resolve(ref.from + 1, -1).name === 'Escape') ref = null;
    let cite = !ref && (scope === 'code' || scope === 'reference') ? citePrefixAt(text, pos) : null;
    if (cite) {
        // Some recovery nodes omit comment trivia. Require an actual callee at
        // the trigger, so text such as `font: /* #cite(` cannot impersonate code.
        const start = text.lastIndexOf('#cite(', pos);
        const callee = tree.resolve(start + 4, -1);
        if (callee.name !== 'Ident' || callee.from !== start + 1 || callee.to !== start + 5) cite = null;
    }
    return { scope, ref, cite };
}
