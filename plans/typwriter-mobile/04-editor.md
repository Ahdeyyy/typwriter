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

Touch ergonomics, all of it about hitting a target you can't see under your own
finger: `line-height: 1.75` (line height *is* the vertical touch target, and the
gap between lines is what stops a long-press landing one line off), a 2px caret,
and `EditorView.scrollMargins` of 32px so every `scrollIntoView` CodeMirror does
on its own leaves context around the caret instead of tucking it under the
completion strip.

**Keep `@codemirror/view` current.** The root `package.json` pins it (both apps
must resolve to exactly one copy — two trigger the tile-tree crash), and a stale
pin silently withholds fixes that read as app bugs. 6.38.8 was holding back
6.39.15 "fix scrolling cursor into view on Chrome Android", 6.39.16 scroll
stabilization, 6.39.17 touch tap-selection on wrapped lines, and 6.43.2's Chrome
Android select-all and tap-on-empty-line scroll workarounds — between them a
large part of what was reported as "the cursor jumps out of frame".

Caret visibility: after focus or doc edits the caret can hide behind the keyboard.
Shipped as `lib/editor/caret-visibility.ts`, a ViewPlugin enforcing one rule — the
caret's client rect must lie inside `scrollDOM.getBoundingClientRect()` ∩
`visibleViewportRect()`, corrected by adjusting `scrollDOM.scrollTop` directly.

**Occlusion must be measured against the visual viewport, never inferred from the
editor's box.** Two earlier attempts failed because they used the box: CM's own
`scrollIntoView` on selection changes, and a ResizeObserver that re-scrolled when
`scrollDOM` *shrank*. Three cases defeat both:

- A pan (`offsetTop` rises) makes `inset = covered − offsetTop` fall, so the shell
  **grows**. The scroller gets bigger while the visible band slides down — no
  shrink to observe, and the scroller's box now extends past the keyboard's top
  edge, so `y: "nearest"` calls an occluded caret visible.
- With the keyboard already up, moving the caret (typing, Enter at the bottom,
  tapping a low line) resizes nothing at all.
- While the keyboard animates in there is no measurement yet — some devices report
  the viewport once, at the end.

Triggers, all funnelling into one rAF-coalesced correction: `keyboard.onViewportChange`
(the only signal for a pan), a ResizeObserver on `scrollDOM` (toolbar mounting,
completion strip), `selectionSet`/`docChanged` while the keyboard is up, and a
settle ramp at 0/60/160/320/500 ms after any of them. Within 700 ms of focus the
band is pre-cut by `keyboard.lastHeight` (the last measured keyboard), so the caret
clears the keyboard *as* it opens — which also removes Chrome's reason to pan, since
it only pans when the focused caret isn't already visible.

**When not to correct** matters as much, and getting it wrong is what made
selecting text on a phone feel broken. Two suspensions:

- **A non-empty selection.** A range means a selection gesture is live — drag
  handles, magnifier, the browser's own edge autoscroll — with a finger resting
  on a specific glyph. Scrolling the text out from under it re-aims the handle at
  whatever slid into that spot, which moves the head, which triggers another
  correction: a runaway that ends with the selection somewhere the user never
  pointed and the caret off screen. This plugin keeps a *caret* clear of the
  keyboard; during a range selection there isn't one. No re-arm needed —
  collapsing the selection arrives as a `selectionSet`.
- **A finger on the editor**, plus a 350 ms grace after it lifts (a lift is
  usually mid-gesture: re-grabbing a handle, the second tap of a double-tap, the
  next flick of a scroll). This one *does* re-arm, because Android's selection
  handles are browser chrome and swallow the `pointerup` that would otherwise
  wake it.

Related: `lib/editor/scroll-pin.ts` holds `scrollTop` across the Sparkle button's
IPC round trip. Requesting suggestions must not move the viewport, and between
the tap landing outside the contenteditable and the strip's first layout there
are several things that will. It yields to a caret/doc change, to a finger on the
scroller, and to a 700 ms deadline.

## 4.4 Keyboard toolbar — `components/toolbar/editor-toolbar.svelte`

A horizontal, scrollable row of buttons docked at the bottom of the editor screen.
`interactive-widget=resizes-content` turned out **not** to be what Android WebView
gives us — the layout viewport keeps its full height and the keyboard only eats the
bottom of the *visual* viewport — so flex layout alone is not enough.
`lib/editor/keyboard-visibility.svelte.ts` derives two distinct numbers and
publishes exactly one custom property, `--app-height` (= layout height − inset);
the shell stays anchored at `top: 0` of the layout viewport and is shortened by the
inset, so the toolbar lands exactly above the keyboard.

- `covered = documentElement.clientHeight − vv.height` — the **keyboard height**.
- `inset = covered − vv.offsetTop` — what to subtract from a shell anchored at
  layout y=0, since a pan already accounts for that much of the keyboard.

Three things that must not regress:

- **Do not** translate the shell by `vv.offsetTop`. Chrome scrolls the visual
  viewport to lift the caret above the keyboard; moving the shell down by the same
  amount cancels that scroll and parks the caret behind the keyboard again.
- **Do not** size with `covered` — with a pan in flight the shell overshoots and
  the toolbar hides behind the keyboard.
- **Do not** detect with `inset` — a large pan makes it read as "keyboard closed"
  and swaps the keyboard toolbar out from under a live keyboard. Detection is
  `covered > 150` OR a drop from the tallest layout height seen at the current
  width (reset on rotation), which is what covers the `resizes-content` case where
  both heights shrink together and `covered` is ~0.

The price of anchoring at `top: 0` is that the shell's box and the visible band stop
coinciding whenever `offsetTop > 0` — the shell's top `offsetTop` px are scrolled off
screen. Cosmetic for the header, but it means **nothing inside the shell may treat
"inside my box" as "on screen"**. `visibleViewportRect()` (exported from the same
module) is the on-screen band in `getBoundingClientRect()` coordinates; that is the
reference for anything that must stay visible.

Two stacked rows, each 40px:

1. **Completion strip** (phase 5) — rendered only while suggestions exist.
2. **The pill.** Pinned left: the Sparkle (manual completions) and a mode toggle;
   pinned right: undo, redo, hide-keyboard. The scrolling middle shows one of two
   rows, because writing and positioning are different jobs and the row is only
   wide enough to be good at one of them.

   **Symbol row** (default) — buttons insert text at the cursor / wrap the
   selection via `view.dispatch`:

   `#` `$` `*` `_` `` ` `` `=` `-` `+` `/` `(` `)` `[` `]` `{` `}` `"` `<` `>` `@`

   Insert behavior: single chars insert and place the cursor after; paired chars
   (`(`, `[`, `{`, `$`, `*`, `_`, `` ` ``, `"`) wrap the selection if non-empty,
   else insert the pair with the cursor in the middle. `$` wraps as `$…$` (Typst math).

   **Cursor row** (`components/toolbar/cursor-row.svelte`, commands in
   `lib/editor/selection.ts`) — caret placement and selection by button and
   gesture, because placing a caret with a fingertip means aiming at a target a
   few pixels wide that your own finger is covering, and Android's handles snap
   to word boundaries as often as not. Three ways to move, and one modifier:

   - tap an arrow — one character or line (char / word / line-boundary, both
     directions, plus up/down);
   - hold an arrow — the same step on repeat, 400 ms before the first and
     accelerating after, stopping dead at the ends of the document;
   - drag the grip — a trackpad: 11px per character horizontally, 26px per line
     vertically, both axes at once. This is the one that makes long selections
     bearable, because the hand is nowhere near the text being selected.
   - the **Select** toggle turns all three into selection tools (`cursor*` →
     `select*`), so a selection is built the same way it is navigated. Turning it
     off collapses the range, so one can't be stranded on screen. Alongside it:
     select word / line / all, with word the usual starting point — grab it, then
     widen by character.

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
8. Long-press to select, then drag a handle across several lines: the text under
   the finger does not move, and the selection ends where the handle was left.
   Same while finger-scrolling — the view stays where it was put.
9. Tapping the Sparkle button does not move the editor by a pixel.
10. Cursor row: arrows step and repeat on hold, the grip scrubs in both axes, and
    with **Select** on all of them extend the selection instead of moving.
