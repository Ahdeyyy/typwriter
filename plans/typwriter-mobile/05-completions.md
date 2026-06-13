# Phase 5 — Touch completions (the completion strip)

Goal: completions that work without Ctrl+Space or precise pointer hovering. A
horizontal chip strip sits directly above the symbol row (above the keyboard);
suggestions appear automatically as you type and on demand from a toolbar button;
tapping a chip inserts it.

Depends on: phase 2 (`get_completions`), phase 4 (editor + toolbar). CM's own
`autocompletion()` UI is **not** used — this is a fully custom controller + Svelte UI,
which is simpler to reason about than restyling CM's floating tooltip for touch, and it
keeps the suggestion UI out of the document's way.

## UX spec

- **Auto-trigger:** after the user types, if the text before the cursor matches a
  "completable" context (rules below), request completions (debounced 150 ms). Show up
  to ~20 chips, horizontally scrollable. The strip row is simply hidden when empty —
  no layout jump taller than the row itself.
- **Manual trigger:** a `Sparkle` button at the left edge of the symbol row calls
  `trigger(explicit = true)` — works anywhere, including where auto-trigger rules
  decline (this replaces Ctrl+Space).
- **Accept:** tap a chip → replace `[from, cursor)` with the completion's apply text →
  strip clears → focus stays in the editor (pointerdown + preventDefault, same trick as
  the symbol row).
- **Dismiss:** strip auto-clears when the cursor moves away from the trigger position,
  on blur, on file switch, and on accept. No explicit close button needed (it's not
  modal — it never blocks anything).
- **Detail rendering:** chip = optional kind icon + label. Function kinds show `ƒ`
  prefix (or `MathOperations`/`Function` phosphor icon at 14px). Snippet-style applies
  (containing `${…}` placeholders) are flattened — see Snippets below.

## Trigger rules (auto)

Request when, at the cursor, either:
- the char just typed is `#`, `@`, or `.` (immediate trigger, no word needed), or
- there's a word of ≥ 2 chars immediately before the cursor (`/[\w-]{2,}$/` against the
  60 chars before the cursor).

Do **not** auto-request when the cursor is inside a line comment (`//` before cursor on
the same line with no newline between) — cheap check, skips obvious noise. Everything
else is typst-ide's job; it already returns null/empty where completions make no sense.

## Controller — `lib/editor/completion-controller.svelte.ts`

```ts
export interface StripItem {
  label: string;
  kind: string;
  apply: string;        // already flattened, see Snippets
  cursorOffset: number; // where to put the cursor inside `apply` after insert (-1 = end)
}

class CompletionStore {
  items = $state<StripItem[]>([]);
  from = $state(0);           // UTF-16 doc offset the items replace from
  anchorCursor = $state(0);   // cursor position at request time
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;     // drop out-of-order responses

  /** Called from the CM updateListener (docChanged || selectionSet). */
  onCursorActivity(update: ViewUpdate) {
    const head = update.state.selection.main.head;
    // cursor moved off the active region? clear.
    if (this.items.length && (head < this.from || head > this.anchorCursor + 1)) this.clear();
    if (!update.docChanged) return;
    if (!autoTriggerApplies(update.state, head)) { this.clear(); return; }
    this.schedule(update.view, /* explicit */ false);
  }

  trigger(view: EditorView) { this.schedule(view, true, /* immediate */ true); }

  private schedule(view: EditorView, explicit: boolean, immediate = false) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.request(view, explicit),
                                    immediate ? 0 : 150);
  }

  private async request(view: EditorView, explicit: boolean) {
    const seq = ++this.requestSeq;
    const head = view.state.selection.main.head;
    const text = view.state.doc.toString();
    const res = await getCompletions(editor.relPath!, text, head, explicit);
    if (seq !== this.requestSeq) return;                  // stale
    if (view.state.selection.main.head !== head) return;  // cursor moved while waiting
    res.match((r) => {
      this.items = r.completions.slice(0, 20).map(flattenSnippet);
      this.from = r.from;
      this.anchorCursor = head;
    }, () => this.clear());
  }

  accept(view: EditorView, item: StripItem) {
    const head = view.state.selection.main.head;
    const insert = item.apply;
    view.dispatch({
      changes: { from: this.from, to: head, insert },
      selection: { anchor: this.from + (item.cursorOffset >= 0 ? item.cursorOffset : insert.length) },
      scrollIntoView: true,
    });
    this.clear();
    view.focus();
  }

  clear() { this.items = []; }
}
export const completions = new CompletionStore();
```

Performance note: `doc.toString()` on every (debounced) request is fine for mobile-size
documents (CM rope → string of < 1 MB is sub-millisecond); don't optimize it.

## Snippets

typst-ide returns LSP-ish snippet applies, e.g. `image(${})` or
`#figure(${}, caption: [${}])`. The strip is not a snippet engine. Flatten:

```ts
function flattenSnippet(c: IpcCompletion): StripItem {
  const apply = c.apply ?? c.label;
  const firstHole = apply.indexOf("${");
  const flattened = apply.replace(/\$\{[^}]*\}/g, "");
  return {
    label: c.label, kind: c.kind,
    apply: flattened,
    cursorOffset: firstHole >= 0 ? firstHole : -1,  // cursor lands at the first hole
  };
}
```

So accepting `image(${})` inserts `image()` with the cursor inside the parens. Only
the first placeholder gets cursor treatment; later holes are the user's problem (v1).

## Strip UI — `components/toolbar/completion-strip.svelte`

- `{#if completions.items.length}` row: `overflow-x-auto`, `flex gap-1 px-2`,
  `scrollbar-width: none`, 40px tall, top border, `bg-background`.
- Chip: `<button>` with `rounded-md border px-3 active:bg-accent active:text-accent-foreground
  text-sm font-mono whitespace-nowrap`, kind icon at 14px + label (truncate at ~24ch).
- `onpointerdown={(e) => { e.preventDefault(); completions.accept(editor.view!, item); }}` —
  preventDefault keeps editor focus/keyboard.
- First chip gets a subtly stronger border (it's the top suggestion); no keyboard
  selection model — touch only.

Kind → icon map (phosphor): `Function` → `func…` kinds; `Cube` → module/namespace;
`TextT` → text/string; `Hash` → constant; `Brackets` → type; `At` → label/reference;
fallback `Sparkle`. Match on lowercase substring like the desktop `mapBackendCompletionKind`.

## Symbol-row integration

Phase 4's symbol row gains the `Sparkle` button at its pinned-left position calling
`completions.trigger(editor.view!)`. When the strip has items the symbol row stays
visible below it (two rows stacked, total 80px).

## Unit tests (`bun test`)

`flattenSnippet` and the auto-trigger predicate are pure functions — keep them in
plain `.ts` modules (no Svelte imports) and test them:

- `flattenSnippet`: `image(${})` → apply `image()`, cursorOffset 6; multi-hole
  `#figure(${}, caption: [${}])` flattens both holes, cursor at first; no-hole applies
  pass through with cursorOffset −1; `apply: null` falls back to `label`.
- `autoTriggerApplies`: fires after `#`, `@`, `.`, and ≥2-char words; declines inside
  a `//` line comment; declines on a 1-char word.

## Acceptance criteria

1. Type `#im` → strip shows `image`, `imp`-prefixed functions within ~300 ms; tapping
   `image` yields `#image()` with the cursor inside the parens, keyboard never
   dismissed.
2. Type `#image(` then `Sparkle` button → parameter completions (e.g. `width:`,
   `height:`) appear (explicit mode reaches places auto-trigger doesn't).
3. In math `$ ar $` with cursor after `ar`, completions include `arrow`-family symbols.
4. Moving the cursor away or tapping elsewhere clears the strip; stale responses never
   overwrite a newer state (type fast and verify no flicker of old lists).
5. No completion requests fire while the strip is idle and the user is just moving the
   cursor (check the Rust log: `get_completions` only on doc changes matching the
   trigger rules or explicit taps).
6. Completions work identically after switching files and after recompiles.
