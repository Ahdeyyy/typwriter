// Document outline: the headings of a Typst source, in document order.
//
// Parsed with the same hand-written grammar the editor highlights with, rather
// than by scanning lines for a leading `=`. That distinction is the whole point
// — `= not a heading` inside a raw block, a comment or a string is not a
// heading, and only the parser knows the difference.
//
// Free of Svelte and CodeMirror so it can be unit-tested and reused by both the
// sidebar panel and the palette's `@` mode.

import { parser } from '$lib/typst-codemirror-lang/lezer-typst';
import { lineAt, lineStarts } from '$lib/text-position';

export interface OutlineItem {
    /** 1-6, from the number of `=` in the heading marker. */
    level: number;
    title: string;
    /** Character offset of the heading node's start, for cursor jumps. */
    from: number;
    to: number;
    /** 1-based line number, for display. */
    line: number;
}

/**
 * A heading's own text, with the trailing label stripped.
 *
 * `= Introduction <intro>` outlines as "Introduction": the label is an anchor
 * for references, not part of the title the reader sees.
 */
function cleanTitle(raw: string): string {
    return raw.replace(/<[^<>\s]+>\s*$/, '').trim();
}

export function extractOutline(text: string): OutlineItem[] {
    if (!text) return [];

    const tree = parser.parse(text);
    const starts = lineStarts(text);
    const items: OutlineItem[] = [];

    tree.iterate({
        enter(node) {
            if (node.name !== 'Heading') return;

            const marker = node.node.getChild('HeadingMarker');
            // Without a marker we can't tell the level; the parser always emits
            // one for a Heading, so this is a guard rather than a real case.
            if (!marker) return;

            const level = marker.to - marker.from;
            const title = cleanTitle(text.slice(marker.to, node.to));

            items.push({
                level: Math.min(Math.max(level, 1), 6),
                // An empty heading still occupies a slot in the outline —
                // dropping it would make the list disagree with the document.
                title: title || '(untitled)',
                from: node.from,
                to: node.to,
                line: lineAt(starts, node.from),
            });
        },
    });

    // `iterate` is a pre-order walk, so a heading nested inside a content block
    // can be visited after a later top-level one. Sort so the panel always
    // reads in document order.
    items.sort((a, b) => a.from - b.from);
    return items;
}

/**
 * The index of the outline entry the cursor is currently inside — the last
 * heading at or before `offset`, or -1 when the cursor sits above the first.
 */
export function activeOutlineIndex(items: readonly OutlineItem[], offset: number): number {
    let found = -1;
    for (let i = 0; i < items.length; i++) {
        if (items[i].from <= offset) found = i;
        else break;
    }
    return found;
}

/**
 * The chain of ancestors for `index`, outermost first, for breadcrumbs.
 * A heading is an ancestor when it is earlier and of a strictly lower level.
 */
export function outlineBreadcrumb(
    items: readonly OutlineItem[],
    index: number
): OutlineItem[] {
    if (index < 0 || index >= items.length) return [];
    const chain: OutlineItem[] = [items[index]];
    let level = items[index].level;
    for (let i = index - 1; i >= 0 && level > 1; i--) {
        if (items[i].level < level) {
            chain.unshift(items[i]);
            level = items[i].level;
        }
    }
    return chain;
}
