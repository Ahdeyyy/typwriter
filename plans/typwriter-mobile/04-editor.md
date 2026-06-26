# Phase 4 — Lean CodeMirror editor, save model, keyboard toolbar

Goal: a fast Typst editor. Typing never crosses the IPC bridge; saving is automatic and
invisible; the symbol toolbar docks above the soft keyboard.

Depends on: phase 2 (`read_file`, `save_file`), phase 3 (editor screen shell).

## 4.1 Typst language support — `lib/editor/typst-lang/`

Copy the language package from the desktop app (snapshot copy — the codebases stay
independent). The Typst parser is a **hand-written incremental parser in TypeScript**
— there is no `.grammar` file, no generated `parser/` directory, and nothing to
regenerate. (Desktop's `package.json` used to carry a stale `generate-parser` script
pointing at a nonexistent `typst.grammar`; it was removed 2026-06-13.) Verified file
list at desktop commit `9baf8a5`:

```
from apps/typwriter-desktop/src/lib/typst-codemirror-lang/
  typst.ts            (typst(), typstLanguage — Language/LanguageSupport wiring,
                       fold + indent node props)
  lezer-typst/        (the full parser: index.ts, parser.ts, scanner.ts, markup.ts,
                       code.ts, math.ts, nest.ts, types.ts, highlight.ts)
  themes/light.ts
  themes/dark.ts
to   apps/typwriter-mobile/src/lib/editor/typst-lang/
```

Do **not** copy `spellcheck.ts`, `comment-decorations.ts`, or `commands.ts`
(desktop-only decorations and keybindings — `typstKeymap` assumes hardware modifier
keys). Write a fresh `index.ts` in the mobile app exporting only:

```ts
export { typst, typstLanguage } from "./typst";
export { light } from "./themes/light";
export { dark } from "./themes/dark";
```

While copying `typst.ts`:

- Drop nested-code-language support — mobile doesn't bundle other languages. If the
  copied file imports `@codemirror/language-data` (or accepts a `codeLanguages`
  config), remove that import and the config path; call sites become `typst()` with
  no arguments. Raw code blocks render as plain text; acceptable.
- Keep both `light` and `dark` theme extensions; they're the design-system-matched
  editor themes.
- The only lezer imports the package needs are `@lezer/common` and `@lezer/highlight`
  (already in phase 1's `package.json`). If the copy introduces an import that isn't
  installed, STOP and check whether you copied a desktop-only module by mistake
  rather than adding dependencies.

Only `.typ` files get language support. Other text files open as plain text (no
lang-json/yaml/markdown packages in this app). Images open in a simple
`<img src={dataUrl}>` viewer; `unsupported` shows a notice.

## 4.2 Editor store — `stores/editor.svelte.ts`

```ts
class EditorStore {
  relPath = $state<string | null>(null);
  fileKind = $state<"text" | "image" | "unsupported" | null>(null);
  imageDataUrl = $state<string | null>(null);
  dirty = $state(false);
  saving = $state(false);
  /** Set by the screen component once the EditorView exists. */
  view: EditorView | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  loadFile(relPath: string): ResultAsync<void, string>
  // 1. flush() current file if dirty
  // 2. read_file; on text: create/replace CM state with content (see 4.3)
  // 3. set_last_file(relPath)

  /** Called from CM's updateListener on every doc change. NO IPC here. */
  handleDocChanged() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), settings.autosaveMs);
  }

  /** Persist now. Single-flight: concurrent calls coalesce. */
  flush(): ResultAsync<void, string>
  // no-op when !dirty or no text file; reads view.state.doc.toString(),
  // save_file(relPath, content); on Ok: dirty=false; then compileStore.onSaved()
}
export const editor = new EditorStore();
```

`flush()` is the **only** writer. It runs on: autosave timer, editor blur, opening the
preview, switching files, leaving the editor screen, and `visibilitychange → hidden`
(app backgrounded — Android may kill the process; this is the crash-safety save).
Register the `visibilitychange` listener once in the editor screen component.

`compileStore.onSaved()` is defined in phase 6; until then make it a no-op stub in
`stores/compile.svelte.ts`.

## 4.3 EditorView factory — `lib/editor/create-editor.ts`

One `EditorView` for the whole app, content swapped per file
(`view.setState(EditorState.create({...}))` on load). Extension set — this is the
"lean" list; do not add more without updating this plan:

```ts
import { EditorView, keymap, highlightActiveLine, lineNumbers, placeholder } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching, syntaxHighlighting } from "@codemirror/language";

const themeC = new Compartment();      // light | dark (follow mode-watcher)
const lineNumbersC = new Compartment();// settings.showLineNumbers
const fontSizeC = new Compartment();   // settings.editorFontSize

export function createExtensions(lang: Extension | null) {
  return [
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    EditorView.lineWrapping,                    // always on — no horizontal scroll on phones
    highlightActiveLine(),
    lineNumbersC.of(settings.showLineNumbers ? lineNumbers() : []),
    themeC.of(currentTheme()),
    fontSizeC.of(fontTheme()),
    ...(lang ? [lang] : []),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) editor.handleDocChanged();
      if (u.docChanged || u.selectionSet) completions.onCursorActivity(u); // phase 5
    }),
    EditorView.domEventHandlers({ blur: () => { void editor.flush(); return false; } }),
    EditorView.contentAttributes.of({
      autocapitalize: "off", autocorrect: "off", spellcheck: "false",
      "data-enable-grammarly": "false",
    }),
    baseTheme(),
  ];
}
```

Deliberately **excluded** (vs. desktop) — do not re-add:

| Excluded | Why |
|---|---|
| `drawSelection()` | breaks Android native selection handles + magnifier; native selection is the better mobile UX |
| `autocompletion()` (CM's UI) | replaced by the custom completion strip, phase 5 |
| `lintGutter` / `setDiagnostics` | diagnostics live in a bottom drawer (phase 7); no gutter real estate on phones |
| `foldGutter`, indentation markers | gutter space, low mobile value |
| `search` extension + panel | stretch goal, not v1 |
| `hoverTooltip` | no hover on touch |
| vscode keymap, Mod-S/Mod-F bindings | no reliable modifier keys on soft keyboards; autosave replaces Ctrl+S |
| per-keystroke `update_file_content` IPC | the whole point of this app |

`baseTheme()`: `& { height: 100%; font-size: var per settings }`,
`.cm-content { padding-bottom: 40vh }` (so the caret can always scroll above the
keyboard), comfortable `.cm-line` padding, and — important on Android —
`.cm-scroller { overflow: auto; -webkit-overflow-scrolling: touch; }`.

Caret visibility: after focus or doc edits the caret can hide behind the keyboard;
CM's `EditorView.scrollIntoView` on selection changes handles most of it, but verify
on-device and, if needed, call `view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) })`
from a `geometryChangeRequested` hook tied to the visualViewport resize (below).

## 4.4 Keyboard toolbar — `components/toolbar/editor-toolbar.svelte`

A horizontal, scrollable row of buttons docked at the bottom of the editor screen.
Because `interactive-widget=resizes-content` + `adjustResize` make the keyboard shrink
the layout viewport, **normal flex layout is enough**: the toolbar sits at the bottom
of the flex column and lands exactly above the keyboard. Add a `visualViewport`
`resize` listener only to detect "keyboard visible" (viewport height dropped > 150px)
for showing/hiding keyboard-specific buttons. Keep that hook in
`lib/editor/keyboard-visibility.svelte.ts`.

Two stacked rows, each 40px:

1. **Completion strip** (phase 5) — rendered only while suggestions exist.
2. **Symbol row** (always visible while a text file is open):
   buttons insert text at the cursor / wrap the selection via `view.dispatch`:

   `#` `$` `*` `_` `` ` `` `=` `-` `+` `/` `(` `)` `[` `]` `{` `}` `"` `<` `>` `@`

   plus, pinned at the right edge (not scrolling): undo, redo (from
   `@codemirror/commands`), and a hide-keyboard button (`input.blur()` → also flushes).

   Insert behavior: single chars insert and place the cursor after; paired chars
   (`(`, `[`, `{`, `$`, `*`, `_`, `` ` ``, `"`) wrap the selection if non-empty,
   else insert the pair with the cursor in the middle. `$` wraps as `$…$` (Typst math).

Buttons: `pointerdown` + `event.preventDefault()` so the editor never loses focus /
keyboard never dismisses when tapping toolbar buttons. This is critical — test it
first on-device.

## 4.5 Wire-up in the editor screen

- `editor.svelte` hosts a `<div bind:this={host} class="min-h-0 flex-1">`; on mount
  create the `EditorView`, store it on `editor.view`, append `view.dom`.
- `$effect` blocks reconfigure compartments when `mode.current` (theme),
  `settings.showLineNumbers`, `settings.editorFontSize` change — same pattern as
  desktop (dispatch `compartment.reconfigure(...)`).
- Loading state: skeleton while `read_file` is in flight.
- The top-bar dirty dot: `editor.dirty || editor.saving` (dot pulses while saving).

## Acceptance criteria (test on a physical device if at all possible)

1. Open `main.typ`; type continuously and fast — zero jank, and the network/IPC log
   shows **no** calls while typing; one `save_file` fires 600 ms after the last
   keystroke.
2. Syntax highlighting works in markup, code (`#let x = 1`), and math (`$x^2$`)
   contexts; light and dark themes both legible.
3. Long-press text selection shows Android's native handles and context menu
   (copy/paste work).
4. Symbol row: every button inserts/wraps correctly **without dismissing the
   keyboard**; undo/redo work; hide-keyboard saves.
5. Backgrounding the app (home gesture) with unsaved edits persists them
   (kill the app from recents, reopen, content is there).
6. Switching files via the tree saves the old file first; images open in the viewer.
7. Caret never ends up hidden behind the keyboard after typing at the bottom of a
   long document.
