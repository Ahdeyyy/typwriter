// The file's name as a heading above the first line, scrolling away with the
// text — Obsidian's "inline title". The phone header has no title of its own:
// it is floating buttons only, and the title lives in the document.
//
// A block widget, so CodeMirror measures it as part of the content (gutters,
// caret coordinates and scrolling all account for it), and not part of the
// document (it is never saved, selected or searched). It comes from a state
// field because block decorations can't come from a view plugin.

import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, type Extension } from "@codemirror/state";

/** The title shown for `relPath`: its base name, without a `.typ` extension. */
export function inlineTitleFor(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return base.replace(/\.typ$/i, "");
}

class TitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  eq(other: TitleWidget) {
    return other.title === this.title;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-inline-title";
    el.setAttribute("aria-hidden", "true");
    el.textContent = this.title;
    return el;
  }
}

const theme = EditorView.theme({
  ".cm-inline-title": {
    fontFamily: "var(--app-font-sans)",
    fontSize: "1.7em",
    fontWeight: "700",
    lineHeight: "1.25",
    letterSpacing: "-0.015em",
    padding: "0.25rem 0.5rem 0.9rem",
    overflowWrap: "anywhere",
    color: "var(--foreground)",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
});

/** Inline title extension for `title`; empty for no title. */
export function inlineTitle(title: string): Extension {
  if (!title) return [];
  const decorations = Decoration.set([
    Decoration.widget({ widget: new TitleWidget(title), block: true, side: -1 }).range(0),
  ]);
  const field = StateField.define<DecorationSet>({
    create: () => decorations,
    // Anchored at 0 with side −1, it stays above whatever becomes the first
    // line, including text typed at the very start.
    update: (deco, tr) => deco.map(tr.changes),
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme];
}
