// Touch completion controller. Drives a custom chip strip (not CM's
// autocompletion UI): debounced auto-trigger while typing, manual trigger from
// the Sparkle button, tap-to-accept. Stale responses are dropped by sequence.
//
// The backend hands back typst-ide's *unfiltered* candidate set for the cursor
// position — every binding in scope, or the whole markup snippet list. Ranking
// it against what the user has typed is this file's job (CodeMirror's
// `autocompletion()` does the equivalent on desktop); without it the strip
// shows the first N things typst happened to emit, so `#im` would surface
// `align, alt, arguments, …` and never `image`.

import type { EditorState } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { getCompletions } from "$lib/ipc/commands";
import { editor } from "$lib/stores/editor.svelte";
import { pinScroll } from "./scroll-pin";
import {
  autoTriggerApplies,
  rankCompletions,
  toStripItem,
  completionAnchor,
  type StripItem,
} from "./completion-logic";
import { canReuseCompletions, completionScope, type CompletionSnapshot } from "./completion-context";

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 20;

class CompletionStore {
  /** Ranked and truncated — exactly what the strip renders. */
  items = $state.raw<StripItem[]>([]);
  /** UTF-16 doc offset accepting an item replaces from. */
  from = $state(0);

  /** Every candidate the last response carried, unranked. Kept so each
   *  keystroke can re-narrow the strip locally instead of waiting for (and
   *  flickering through) another round trip. */
  private all: StripItem[] = [];
  private snapshot: (CompletionSnapshot & { view: EditorView; relPath: string }) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;
  /** Releases the scroll pin held across a manual trigger, if one is active. */
  private unpin: (() => void) | null = null;

  /** Called from the CM updateListener (docChanged || selectionSet). */
  onCursorActivity(update: ViewUpdate) {
    const sel = update.state.selection.main;
    const head = sel.head;
    if (!editor.relPath?.endsWith(".typ") || !sel.empty) {
      this.clear();
      return;
    }
    if (!update.docChanged) {
      // Cancel queued and in-flight requests even before candidates arrive.
      if (update.selectionSet) this.clear();
      return;
    }
    // Cached candidates are valid only while their surrounding syntax stays
    // unchanged. Changing an argument, string delimiter or path invalidates it.
    if (this.all.length) {
      const inRegion = this.snapshot && this.snapshot.view === update.view &&
        this.snapshot.relPath === editor.relPath && canReuseCompletions(this.snapshot, update.state);
      if (inRegion) this.refilter(update.state);
      else this.clear();
    }
    const line = update.state.doc.lineAt(head);
    const before = update.state.doc.sliceString(line.from, head);
    if (!autoTriggerApplies(before, completionScope(update.state))) {
      this.clear();
      return;
    }
    this.schedule(update.view, false);
  }

  /** Manual trigger (Sparkle button) — reaches places auto-trigger declines. */
  trigger(view: EditorView) {
    const scope = completionScope(view.state);
    if (!editor.relPath?.endsWith(".typ") || !view.state.selection.main.empty || scope === "comment" || scope === "raw") {
      this.clear();
      return;
    }
    // Nothing about asking for suggestions should move the editor, but the tap
    // lands outside the contenteditable and the answer comes back a round trip
    // later, which between them give Chrome and the strip's first layout plenty
    // of opportunity to re-anchor the scroller. See scroll-pin.ts.
    this.unpin?.();
    this.unpin = pinScroll(view);
    this.schedule(view, true, true);
  }

  private schedule(view: EditorView, explicit: boolean, immediate = false) {
    this.requestSeq++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.request(view, explicit), immediate ? 0 : DEBOUNCE_MS);
  }

  private async request(view: EditorView, explicit: boolean) {
    this.debounceTimer = null;
    const relPath = editor.relPath;
    if (!relPath?.endsWith(".typ") || editor.view !== view || !view.state.selection.main.empty) return;
    const seq = this.requestSeq;
    const head = view.state.selection.main.head;
    const text = view.state.doc.toString();
    const res = await getCompletions(relPath, text, head, explicit);
    if (seq !== this.requestSeq) return; // stale response
    if (editor.view !== view || editor.relPath !== relPath) return;
    if (view.state.selection.main.head !== head || view.state.doc.toString() !== text) return;
    res.match(
      (r) => this.adopt(view, relPath, r.completions.map(toStripItem), r.from),
      () => this.clear(),
    );
  }

  /** Install a fresh candidate set and pick the anchor it replaces from. */
  private adopt(view: EditorView, relPath: string, all: StripItem[], typstFrom: number) {
    const state = view.state;
    if (!all.length || typstFrom < 0 || typstFrom > state.selection.main.head) {
      this.clear();
      return;
    }
    this.all = all;
    const text = state.doc.toString();
    const to = state.selection.main.head;
    const scope = completionScope(state);
    this.from = completionAnchor(text, to, typstFrom, scope, all);
    this.snapshot = { text, from: this.from, to, scope, view, relPath };
    this.refilter(state);
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
    if (!this.snapshot || view !== editor.view || view !== this.snapshot.view ||
      editor.relPath !== this.snapshot.relPath || !canReuseCompletions(this.snapshot, view.state) || !this.items.includes(item)) {
      this.clear();
      return;
    }
    // Accepting is exactly the case the pin must get out of the way of: the
    // insert scrolls the caret into view on purpose.
    this.unpin?.();
    this.unpin = null;
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
    this.requestSeq++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.unpin?.();
    this.unpin = null;
    this.items = [];
    this.all = [];
    this.snapshot = null;
  }
}

export const completions = new CompletionStore();
