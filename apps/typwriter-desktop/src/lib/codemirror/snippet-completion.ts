// Snippet completion.
//
// Snippets ride the normal completion list rather than getting a picker of
// their own: it is the mechanism users already reach for, and it means a
// snippet competes with — and can be ranked against — the typst-ide suggestion
// for the same prefix.

import { snippet as cmSnippet, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

import { refPrefixAt } from '$lib/references';
import type { Snippet } from '$lib/snippets';
import { completionScope, completionTree } from './completion-context';
import type { Tree } from '@lezer/common';

/** Characters that can precede the caret and still be a snippet name. */
const NAME_CHARS = /[\p{L}\p{N}_-]/u;

/**
 * The word immediately before `pos`, and where it starts.
 *
 * Returns `null` when there is no word — an explicit completion request with no
 * prefix still wants the full list, which the caller handles separately.
 */
export function wordBefore(text: string, pos: number): { from: number; word: string } | null {
    let i = pos;
    while (i > 0 && NAME_CHARS.test(text[i - 1])) i--;
    if (i === pos) return null;
    return { from: i, word: text.slice(i, pos) };
}

/**
 * Whether `pos` sits somewhere a snippet makes sense.
 *
 * Snippets insert markup, so only offer them in markup and content blocks.
 * The syntax tree handles strings, nested comments, raw delimiters and math.
 */
export function inInsertableContext(text: string, pos: number, tree?: Tree): boolean {
    // Mid-reference: `@fig` is a reference being typed, and the reference source
    // owns that position. Two sources answering it with different `from` offsets
    // gives CodeMirror a list it cannot filter coherently.
    if (refPrefixAt(text, pos)) return false;

    return completionScope(text, pos, tree) === 'markup';
}

/**
 * A completion source offering `snippets`.
 *
 * Only fires for an explicit request or once at least two characters are typed:
 * a single letter matches too many snippets to be useful and would push the
 * language server's suggestions down the list on every keystroke.
 */
export function snippetCompletionSource(snippetsOf: () => readonly Snippet[]) {
    return (context: CompletionContext): CompletionResult | null => {
        const text = context.state.doc.toString();
        if (!inInsertableContext(text, context.pos, completionTree(context.state))) return null;

        const hit = wordBefore(text, context.pos);
        if (!hit && !context.explicit) return null;
        if (hit && hit.word.length < 2 && !context.explicit) return null;

        const snippets = snippetsOf();
        if (snippets.length === 0) return null;

        return {
            from: hit?.from ?? context.pos,
            options: snippets.map((entry) => ({
                label: entry.label,
                type: 'snippet',
                detail: entry.description,
                apply: cmSnippet(entry.body),
            })),
            validFor: (word, _from, to, state) =>
                /^[\p{L}\p{N}_-]*$/u.test(word) &&
                inInsertableContext(state.doc.toString(), to, completionTree(state)),
        };
    };
}
