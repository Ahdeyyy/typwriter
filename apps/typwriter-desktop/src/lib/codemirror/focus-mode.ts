// Focus mode and typewriter scrolling.
//
// Two ideas usually bundled together, kept as separate settings because people
// want them independently:
//
//   focus mode           — dim every paragraph except the one the caret is in
//   typewriter scrolling — keep the caret line vertically centred
//
// Both are view concerns. Nothing here touches the document, so neither can
// affect what gets compiled or saved.

import { EditorView, ViewPlugin, Decoration, type DecorationSet } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Opacity applied to text outside the active paragraph. */
const DIMMED_OPACITY = 0.35;

const dimMark = Decoration.mark({ class: 'cm-focus-dimmed' });

/** The part of CodeMirror's `Text` this needs — small enough to fake in tests. */
export interface LineIndex {
    readonly lines: number;
    line(n: number): { from: number; to: number; text: string };
    lineAt(pos: number): { from: number; to: number; number: number; text: string };
}

export interface Range {
    from: number;
    to: number;
}

/**
 * Bounds of the paragraph containing `pos`.
 *
 * A paragraph is a run of non-blank lines. That matches Typst's own parbreak
 * rule closely enough for a reading aid, and unlike consulting the parser it
 * costs nothing on the render path.
 *
 * A caret on a blank line is *between* paragraphs, so only that line stays lit
 * — dimming nothing would be wrong, and picking a neighbouring paragraph would
 * be arbitrary.
 */
export function paragraphAt(doc: LineIndex, pos: number): Range {
    const line = doc.lineAt(pos);
    if (line.text.trim() === '') return { from: line.from, to: line.to };

    let first = line.number;
    while (first > 1 && doc.line(first - 1).text.trim() !== '') first--;

    let last = line.number;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;

    return { from: doc.line(first).from, to: doc.line(last).to };
}

/**
 * Ranges to dim: everything outside `active`.
 *
 * Returned rather than applied so the decision is testable on its own — an
 * empty or inverted range here would blank the whole document.
 */
export function dimmedRanges(active: Range, docLength: number): Range[] {
    const ranges: Range[] = [];
    if (active.from > 0) ranges.push({ from: 0, to: active.from });
    if (active.to < docLength) ranges.push({ from: active.to, to: docLength });
    return ranges;
}

function buildDimDecorations(view: EditorView): DecorationSet {
    const { state } = view;
    const active = paragraphAt(state.doc, state.selection.main.head);
    return Decoration.set(
        dimmedRanges(active, state.doc.length).map((range) =>
            dimMark.range(range.from, range.to)
        )
    );
}

const focusPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildDimDecorations(view);
        }

        update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean }) {
            if (update.docChanged || update.selectionSet) {
                this.decorations = buildDimDecorations(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations }
);

const focusTheme = EditorView.theme({
    '.cm-focus-dimmed': {
        opacity: String(DIMMED_OPACITY),
        // A reading aid should settle rather than snap as the caret moves
        // between paragraphs.
        transition: 'opacity 150ms ease-out',
    },
});

/** Dim everything but the caret's paragraph. */
export function focusMode(): Extension {
    return [focusPlugin, focusTheme];
}

/**
 * Keep the caret line vertically centred.
 *
 * `scrollIntoView(..., { y: 'center' })` is how a line is centred in CodeMirror
 * 6 — there is no separate primitive. The bottom padding is what lets the
 * *last* line reach the middle of the viewport; without it the document runs
 * out and the caret settles at the bottom instead.
 */
export function typewriterScrolling(): Extension {
    return [
        EditorView.theme({
            '.cm-content': { paddingBottom: '40vh' },
        }),
        EditorView.updateListener.of((update) => {
            if (!update.docChanged && !update.selectionSet) return;
            // Never re-scroll while a selection is being dragged out — it
            // fights the user's own movement. Same hazard the mobile app hit
            // with caret-visibility scrolling.
            const range = update.state.selection.main;
            if (!range.empty) return;

            update.view.dispatch({
                effects: EditorView.scrollIntoView(range.head, { y: 'center' }),
            });
        }),
    ];
}
