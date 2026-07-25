// CodeMirror EditorView factory — the deliberately lean mobile extension set.
// One EditorView for the whole app; content is swapped per file via setState.
//
// Excluded vs. desktop (do NOT re-add without updating 04-editor.md):
//   drawSelection (breaks Android native selection handles + magnifier),
//   autocompletion (replaced by the custom completion strip, phase 5),
//   lint/search/fold gutters, hoverTooltip, vscode keymap / Mod-S bindings,
//   per-keystroke IPC.

import { EditorView, keymap, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { typst, light, dark } from "./typst-lang";
import { typstKeymap } from "./commands";
import { inlineDiagnostics } from "./inline-diagnostics";
import { settings } from "$lib/stores/settings.svelte";
import { editor } from "$lib/stores/editor.svelte";
import { completions } from "./completion-controller.svelte";

export const themeC = new Compartment(); // light | dark (follows mode-watcher)
export const lineNumbersC = new Compartment(); // settings.showLineNumbers
export const fontSizeC = new Compartment(); // settings.editorFontSize

export function themeExtensionFor(isDark: boolean): Extension {
  return isDark ? dark : light;
}

export function fontThemeFor(size: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
  });
}

/** `compact` builds the theme for the block surface's mini-editor, which is one
 *  item in a scrolling list rather than the full-height editor: it must size to
 *  its content and must not reserve a keyboard-sized run-off at the bottom. */
function baseTheme(compact: boolean): Extension {
  return EditorView.theme({
    "&": compact ? {} : { height: "100%" },
    ".cm-scroller": {
      overflow: compact ? "visible" : "auto",
      WebkitOverflowScrolling: "touch",
      fontFamily: "var(--font-mono)",
      lineHeight: "1.6",
    },
    // Caret can always scroll above the soft keyboard.
    ".cm-content": { paddingBottom: compact ? "0" : "40vh" },
    ".cm-line": { padding: "0 0.5rem" },
  });
}

/** The lean extension set. `lang` is the language support (or null for plain text). */
export function createExtensions(
  lang: Extension | null,
  opts: { compact?: boolean } = {},
): Extension[] {
  return [
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping, // always on — no horizontal scroll on phones
    highlightActiveLine(),
    inlineDiagnostics(),
    lineNumbersC.of(settings.showLineNumbers ? lineNumbers() : []),
    themeC.of(themeExtensionFor(document.documentElement.classList.contains("dark"))),
    fontSizeC.of(fontThemeFor(settings.editorFontSize)),
    ...(lang ? [lang] : []),
    // typstKeymap before defaultKeymap so Enter continues list items (and
    // Mod-b/i/e toggle marks on hardware keyboards) ahead of the defaults.
    // Typst buffers only — plain text keeps the stock behavior.
    keymap.of([
      ...closeBracketsKeymap,
      ...(lang ? typstKeymap : []),
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) editor.handleDocChanged();
      if (u.docChanged || u.selectionSet) completions.onCursorActivity(u);
    }),
    EditorView.domEventHandlers({
      blur: () => {
        void editor.flush();
        return false;
      },
    }),
    EditorView.contentAttributes.of({
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      "data-enable-grammarly": "false",
    }),
    baseTheme(opts.compact ?? false),
  ];
}

/** Build the language support for a file, or null for non-Typst text. */
export function languageFor(relPath: string): Extension | null {
  return relPath.endsWith(".typ") ? typst() : null;
}

/** Create the EditorView mounted into `parent`, seeded with `doc`. */
export function createEditorView(parent: HTMLElement, doc: string, relPath: string): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: createExtensions(languageFor(relPath)) }),
  });
}

/** Replace the document + language when switching files. */
export function loadDocInto(view: EditorView, doc: string, relPath: string) {
  view.setState(EditorState.create({ doc, extensions: createExtensions(languageFor(relPath)) }));
}
