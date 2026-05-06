import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { toggleLineComment, toggleBlockComment } from "@codemirror/commands";
import type { KeyBinding } from "@codemirror/view";

export { toggleLineComment, toggleBlockComment };

function wrapWith(marker: string) {
  return (view: EditorView): boolean => {
    const { state, dispatch } = view;
    const markerLen = marker.length;

    const changes = state.changeByRange((range) => {
      const before = state.doc.sliceString(range.from - markerLen, range.from);
      const after = state.doc.sliceString(range.to, range.to + markerLen);

      // Cursor between markers (empty) or selection with markers just outside → unwrap
      if (before === marker && after === marker) {
        return {
          range: EditorSelection.cursor(range.from - markerLen),
          changes: [
            { from: range.from - markerLen, to: range.from, insert: "" },
            { from: range.to, to: range.to + markerLen, insert: "" },
          ],
        };
      }

      if (range.empty) {
        // Insert paired markers and place cursor between them
        return {
          range: EditorSelection.cursor(range.from + markerLen),
          changes: { from: range.from, insert: marker + marker },
        };
      }

      // Selection has markers inside it → unwrap
      const text = state.doc.sliceString(range.from, range.to);
      if (text.startsWith(marker) && text.endsWith(marker) && text.length >= markerLen * 2 + 1) {
        return {
          range: EditorSelection.range(range.from, range.to - markerLen * 2),
          changes: [
            { from: range.from, to: range.from + markerLen, insert: "" },
            { from: range.to - markerLen, to: range.to, insert: "" },
          ],
        };
      }

      // Wrap selection
      return {
        range: EditorSelection.range(range.from, range.to + markerLen * 2),
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
      };
    });

    if (changes.changes.empty) return false;
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBold = wrapWith("*");
export const toggleItalic = wrapWith("_");
export const toggleRawInline = wrapWith("`");
export const toggleStrikethrough = wrapWith("~");

export const typstKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-e", run: toggleRawInline },
];
