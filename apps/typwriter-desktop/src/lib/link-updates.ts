// Pure helpers for the link edits `plan_link_updates` returns — mirrored from
// `src-tauri/src/workspace/links.rs`. Offsets are UTF-16 code units, which is
// what JavaScript strings and CodeMirror index by, so they apply directly.

/** One entry moved, workspace-relative. A folder moves what's beneath it. */
export interface PathMove {
    from: string;
    to: string;
    isDir: boolean;
}

/** One literal to replace. Texts include the quotes: `"figs/a.png"`. */
export interface LinkEdit {
    start: number;
    end: number;
    oldText: string;
    newText: string;
}

/** The edits for one file, keyed by its current (post-move) path. */
export interface FileLinkUpdate {
    path: string;
    edits: LinkEdit[];
}

/** `text` with `edits` applied, or null when any edit no longer lines up —
 *  the file changed after the plan. All or nothing, like the Rust side. */
export function applyLinkEdits(text: string, edits: readonly LinkEdit[]): string | null {
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    for (const edit of sorted) {
        if (edit.start < cursor || edit.end < edit.start || edit.end > text.length) return null;
        if (text.slice(edit.start, edit.end) !== edit.oldText) return null;
        out += text.slice(cursor, edit.start) + edit.newText;
        cursor = edit.end;
    }
    return out + text.slice(cursor);
}

/** The edits that take the result of `edits` back to where it started, in the
 *  coordinates of the edited text. */
export function invertLinkEdits(edits: readonly LinkEdit[]): LinkEdit[] {
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    let shift = 0;
    return sorted.map((edit) => {
        const start = edit.start + shift;
        shift += edit.newText.length - (edit.end - edit.start);
        return {
            start,
            end: start + edit.newText.length,
            oldText: edit.newText,
            newText: edit.oldText,
        };
    });
}

export function invertLinkUpdates(updates: readonly FileLinkUpdate[]): FileLinkUpdate[] {
    return updates.map((u) => ({ path: u.path, edits: invertLinkEdits(u.edits) }));
}

export function countLinks(updates: readonly FileLinkUpdate[]): number {
    return updates.reduce((n, u) => n + u.edits.length, 0);
}

/** The path a literal spells, without its quotes — for showing an edit. */
export function literalValue(literal: string): string {
    return literal.length >= 2 && literal.startsWith('"') && literal.endsWith('"')
        ? literal.slice(1, -1)
        : literal;
}

/** "4 links in 3 files", "1 link in 1 file". */
export function describeLinkCount(updates: readonly FileLinkUpdate[]): string {
    const links = countLinks(updates);
    const files = updates.length;
    return `${links} link${links === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`;
}
