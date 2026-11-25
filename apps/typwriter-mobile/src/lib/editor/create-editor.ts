// CodeMirror EditorView factory — the deliberately lean mobile extension set.
// One EditorView for the whole app; content is swapped per file via setState.
//
// Excluded vs. desktop, each for a reason:
//   drawSelection (breaks Android native selection handles + magnifier),
//   autocompletion (replaced by the custom completion strip),
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
import { caretVisibility } from "./caret-visibility";
import { inlineTitle, inlineTitleFor } from "./inline-title";
import { immersive } from "#lib/stores/immersive.svelte.ts";
import { settings } from "#lib/stores/settings.svelte.ts";
import { editor } from "#lib/stores/editor.svelte.ts";
import { completions } from "./completion-controller.svelte";
import { spellcheckFor } from "./spellcheck";

/** Breathing room CodeMirror leaves around the caret when it scrolls to it —
 *  roughly a line and a half at the default size. */
const CARET_SCROLL_MARGIN_PX = 32;

export const themeC = new Compartment(); // light | dark (follows mode-watcher)
export const lineNumbersC = new Compartment(); // settings.showLineNumbers
export const fontSizeC = new Compartment(); // settings.editorFontSize
export const titleC = new Compartment(); // inline title (follows renames)
export const spellC = new Compartment(); // settings.spellcheck (Typst only)

export function themeExtensionFor(isDark: boolean): Extension {
  return isDark ? dark : light;
}

export function fontThemeFor(size: number): Extension {
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
  });
}

function baseTheme(): Extension {
  return EditorView.theme({
    "&": { height: "100%" },
    ".cm-scroller": {
      overflow: "auto",
      WebkitOverflowScrolling: "touch",
      fontFamily: "var(--font-mono)",
      // Roomier than a desktop editor on purpose: line height is the vertical
      // size of a touch target here, and the gap between lines is what stops a
      // long-press landing one line off from where it was aimed.
      lineHeight: "1.75",
    },
    // Caret can always scroll above the soft keyboard. The top clears the
    // status bar and the floating header on phones — the shell is edge to
    // edge, so the editor starts at the top of the screen. The editor screen
    // sets `--editor-pad-top`.
    ".cm-content": { paddingTop: "var(--editor-pad-top, 4px)", paddingBottom: "40vh" },
    ".cm-line": { padding: "0 0.5rem" },
    // A 1px caret is hard to find on a phone, and finding it is the whole job
    // when you are placing it by hand.
    ".cm-cursor, .cm-dropCursor": { borderLeftWidth: "2px" },
  });
}

/** The lean extension set. `lang` is the language support (or null for plain
 *  text); `relPath` names the inline title. */
export function createExtensions(lang: Extension | null, relPath: string): Extension[] {
  return [
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping, // always on — no horizontal scroll on phones
    highlightActiveLine(),
    inlineDiagnostics(),
    caretVisibility(), // keeps the caret out of the soft keyboard's rectangle
    // Every `scrollIntoView` CodeMirror does on its own — toolbar inserts,
    // arrow keys, the cursor row — otherwise parks the caret hard against the
    // scroller's edge, i.e. tucked under the completion strip, with no context
    // on the side you are moving towards.
    // On phones the floating header sits over the top of the scroller, so
    // that much more is out of bounds at the top while it is showing.
    EditorView.scrollMargins.of(() => ({
      top: CARET_SCROLL_MARGIN_PX + immersive.editorObscuredTop,
      bottom: CARET_SCROLL_MARGIN_PX,
    })),
    titleC.of(inlineTitle(settings.showInlineTitle ? inlineTitleFor(relPath) : "")),
    lineNumbersC.of(settings.showLineNumbers ? lineNumbers() : []),
    themeC.of(themeExtensionFor(document.documentElement.classList.contains("dark"))),
    fontSizeC.of(fontThemeFor(settings.editorFontSize)),
    ...(lang ? [lang] : []),
    // The keyboard's own spellcheck stays off (`spellcheck: "false"` below):
    // on a contenteditable it fights CodeMirror over the composing word. This
    // asks the same spellchecker service directly instead, about prose only.
    spellC.of(spellcheckFor(lang !== null, settings.spellcheck)),
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
      if (u.docChanged || u.selectionSet) {
        completions.onCursorActivity(u);
        // Remember where the caret is so reopening the workspace lands here.
        editor.handleCursorMoved();
      }
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
    baseTheme(),
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
    state: EditorState.create({ doc, extensions: createExtensions(languageFor(relPath), relPath) }),
  });
}

/** Replace the document + language when switching files. `cursor` (UTF-16 code
 *  units) restores a remembered caret; it is clamped to the new document and
 *  scrolled into view. Omit it to start at the top. */
export function loadDocInto(
  view: EditorView,
  doc: string,
  relPath: string,
  cursor?: number | null,
) {
  const anchor =
    typeof cursor === "number" ? Math.max(0, Math.min(cursor, doc.length)) : undefined;
  view.setState(
    EditorState.create({
      doc,
      selection: anchor === undefined ? undefined : { anchor },
      extensions: createExtensions(languageFor(relPath), relPath),
    }),
  );
  // `setState` doesn't scroll, so a restored caret deep in the file would sit
  // off-screen until the user touched the editor.
  if (anchor !== undefined) {
    view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
  }
}
