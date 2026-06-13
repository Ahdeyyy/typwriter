// Touch completion controller. Drives a custom chip strip (not CM's
// autocompletion UI): debounced auto-trigger while typing, manual trigger from
// the Sparkle button, tap-to-accept. Stale responses are dropped by sequence.

import type { EditorView, ViewUpdate } from "@codemirror/view";
import { getCompletions } from "$lib/ipc/commands";
import { editor } from "$lib/stores/editor.svelte";
import { autoTriggerApplies, flattenSnippet, type StripItem } from "./completion-logic";

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 20;

class CompletionStore {
  items = $state<StripItem[]>([]);
  from = $state(0); // UTF-16 doc offset the items replace from
  anchorCursor = $state(0); // cursor position at request time

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  /** Called from the CM updateListener (docChanged || selectionSet). */
  onCursorActivity(update: ViewUpdate) {
    const head = update.state.selection.main.head;
    // Cursor moved off the active region → clear.
    if (this.items.length && (head < this.from || head > this.anchorCursor + 1)) this.clear();
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
      (r) => {
        this.items = r.completions.slice(0, MAX_ITEMS).map(flattenSnippet);
        this.from = r.from;
        this.anchorCursor = head;
      },
      () => this.clear(),
    );
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

  clear() {
    this.items = [];
  }
}

export const completions = new CompletionStore();
