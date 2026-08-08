// Touch completion controller. Drives a custom chip strip (not CM's
// autocompletion UI): debounced auto-trigger while typing, manual trigger from
// the Sparkle button, tap-to-accept. Stale responses are dropped by sequence.
//
// The backend hands back typst-ide's *unfiltered* candidate set for the cursor
// position — every binding in scope, or the whole markup snippet list. Ranking
// it against what the user has typed is this file's job (CodeMirror's
// `autocompletion()` does the equivalent on desktop); without it the strip
// shows the first N things typst happened to emit, which is why `#im` used to
// suggest `align, alt, arguments, …` and never `image`.

import type { EditorState, Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { getCompletions } from "$lib/ipc/commands";
import { editor } from "$lib/stores/editor.svelte";
import {
  autoTriggerApplies,
  rankCompletions,
  toStripItem,
  wordStartBefore,
  type StripItem,
} from "./completion-logic";

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 20;

class CompletionStore {
  /** Ranked and truncated — exactly what the strip renders. */
  items = $state<StripItem[]>([]);
  /** UTF-16 doc offset accepting an item replaces from. */
  from = $state(0);

  /** Every candidate the last response carried, unranked. Kept so each
   *  keystroke can re-narrow the strip locally instead of waiting for (and
   *  flickering through) another round trip. */
  private all: StripItem[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  /** Called from the CM updateListener (docChanged || selectionSet). */
  onCursorActivity(update: ViewUpdate) {
    const sel = update.state.selection.main;
    const head = sel.head;
    // Drop the strip once the cursor leaves the active replacement region: a
    // non-empty selection, moved before `from`, or the text from `from` to the
    // cursor is no longer the single identifier being completed. Anchoring to
    // `from` + token continuity (rather than a cursor-delta guess) keeps the
    // list stable through continuous typing while still clearing on a tap away.
    if (this.all.length) {
      const inRegion =
        sel.empty &&
        head >= this.from &&
        /^[#@.]?[\w-]*$/.test(update.state.doc.sliceString(this.from, head));
      if (inRegion) this.refilter(update.state);
      else this.clear();
    }
    if (!update.docChanged) return;
    const line = update.state.doc.lineAt(head);
    const before = update.state.doc.sliceString(line.from, head);
    if (!autoTriggerApplies(before)) {
      this.clear();
      return;
    }
    this.schedule(update.view, false);
  }

  /** Manual trigger (Sparkle button) — reaches places auto-trigger declines. */
  trigger(view: EditorView) {
    this.schedule(view, true, true);
  }

  private schedule(view: EditorView, explicit: boolean, immediate = false) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.request(view, explicit), immediate ? 0 : DEBOUNCE_MS);
  }

  private async request(view: EditorView, explicit: boolean) {
    if (!editor.relPath) return;
    const seq = ++this.requestSeq;
    const head = view.state.selection.main.head;
    const text = view.state.doc.toString();
    const res = await getCompletions(editor.relPath, text, head, explicit);
    if (seq !== this.requestSeq) return; // stale response
    if (view.state.selection.main.head !== head) return; // cursor moved while waiting
    res.match(
      (r) => this.adopt(view.state, r.completions.map(toStripItem), r.from),
      () => this.clear(),
    );
  }

  /** Install a fresh candidate set and pick the anchor it replaces from. */
  private adopt(state: EditorState, all: StripItem[], typstFrom: number) {
    this.all = all;
    this.from = this.anchor(state, typstFrom);
    this.refilter(state);
  }

  /**
   * Where an accepted item should start replacing.
   *
   * typst-ide anchors an *explicit* completion at the cursor even when a word
   * is being typed (`complete_markup` sets `from = cursor` before emitting the
   * snippet list). Taken literally that means the prefix is always empty, so
   * nothing filters, and accepting appends after the half-typed word — tapping
   * "heading" mid-word produced `Line 17 of f= titleiller prose`. When a word
   * sits before the cursor and some candidate actually matches it, treat that
   * word as the prefix instead. If nothing matches it we keep typst's anchor,
   * so tapping the button mid-prose still offers the full snippet list and
   * inserts rather than overwrites.
   */
  private anchor(state: EditorState, typstFrom: number): number {
    const cursor = state.selection.main.head;
    if (typstFrom !== cursor) return typstFrom;
    const start = this.wordStart(state.doc, cursor);
    if (start === cursor) return typstFrom;
    return rankCompletions(this.all, state.doc.sliceString(start, cursor), 1).length
      ? start
      : typstFrom;
  }

  private wordStart(doc: Text, cursor: number): number {
    const line = doc.lineAt(cursor);
    return wordStartBefore(line.text, line.from, cursor);
  }

  /** Re-rank the current candidates against the text typed since `from`. */
  private refilter(state: EditorState) {
    const cursor = state.selection.main.head;
    if (cursor < this.from) {
      this.clear();
      return;
    }
    this.items = rankCompletions(this.all, state.doc.sliceString(this.from, cursor), MAX_ITEMS);
  }

  accept(view: EditorView, item: StripItem) {
    // Focus first: an unfocused view makes Chrome reveal the caret its own way
    // after the insert, on top of the scroll `snippet` already asks for.
    view.focus();
    const head = view.state.selection.main.head;
    // `snippet` inserts the template, selects the first placeholder, and (for
    // multi-hole templates) installs its own Tab/Escape tabstop keymap.
    snippet(item.template)(view, null, this.from, head);
    this.clear();
  }

  clear() {
    this.items = [];
    this.all = [];
  }
}

export const completions = new CompletionStore();
