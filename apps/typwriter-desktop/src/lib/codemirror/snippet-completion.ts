// Snippet completion.
//
// Snippets ride the normal completion list rather than getting a picker of
// their own: it is the mechanism users already reach for, and it means a
// snippet competes with — and can be ranked against — the typst-ide suggestion
// for the same prefix.

import { snippet as cmSnippet, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

import { refPrefixAt } from '$lib/references';
import type { Snippet } from '$lib/snippets';

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
 * Snippets insert markup, so offering them inside a raw block or a comment
 * would be actively wrong. This is a cheap textual test rather than a parse:
 * the completion path runs per keystroke, and a false negative merely withholds
 * a suggestion.
 */
export function inInsertableContext(text: string, pos: number): boolean {
    // Mid-reference: `@fig` is a reference being typed, and the reference source
    // owns that position. Two sources answering it with different `from` offsets
    // gives CodeMirror a list it cannot filter coherently.
    if (refPrefixAt(text, pos)) return false;

    const before = text.slice(0, pos);

    // Inside a fenced raw block when an odd number of fences precede us.
    const fences = (before.match(/```/g) ?? []).length;
    if (fences % 2 === 1) return false;

    // Inside a line comment.
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = before.slice(lineStart);
    const comment = line.indexOf('//');
    if (comment !== -1) return false;

    // Inside a block comment.
    const opens = (before.match(/\/\*/g) ?? []).length;
    const closes = (before.match(/\*\//g) ?? []).length;
    if (opens > closes) return false;

    return true;
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
        if (!inInsertableContext(text, context.pos)) return null;

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
                // `boost` lifts snippets above same-named language suggestions:
                // typing "figure" and pressing Enter should scaffold a figure,
                // not insert the bare identifier.
                boost: 1,
                apply: cmSnippet(entry.body),
            })),
            validFor: /^[\p{L}\p{N}_-]*$/u,
        };
    };
}
