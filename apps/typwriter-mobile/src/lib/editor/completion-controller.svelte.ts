// Touch completion controller. Drives a custom chip strip (not CM's
// autocompletion UI): debounced auto-trigger while typing, manual trigger from
// the Sparkle button, tap-to-accept. Stale responses are dropped by sequence.

import type { EditorView, ViewUpdate } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { getCompletions } from "$lib/ipc/commands";
import { editor } from "$lib/stores/editor.svelte";
import { autoTriggerApplies, toStripItem, type StripItem } from "./completion-logic";

const DEBOUNCE_MS = 150;
const MAX_ITEMS = 20;

class CompletionStore {
  items = $state<StripItem[]>([]);
  from = $state(0); // UTF-16 doc offset the items replace from

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
    if (this.items.length) {
      const inRegion =
        sel.empty &&
        head >= this.from &&
        /^[#@.]?[\w-]*$/.test(update.state.doc.sliceString(this.from, head));
      if (!inRegion) this.clear();
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
    // A block's mini-editor holds only its own span, so resolve the request in
    // master-document coordinates — otherwise completions would be computed
    // against a fragment of the file — and map the answer back.
    const master = editor.masterContext(view, head);
    const res = await getCompletions(editor.relPath, master.text, master.offset, explicit);
    if (seq !== this.requestSeq) return; // stale response
    if (view.state.selection.main.head !== head) return; // cursor moved while waiting
    res.match(
      (r) => {
        this.items = r.completions.slice(0, MAX_ITEMS).map(toStripItem);
        this.from = editor.localOffset(view, r.from);
      },
      () => this.clear(),
    );
  }

  accept(view: EditorView, item: StripItem) {
    const head = view.state.selection.main.head;
    // `snippet` inserts the template, selects the first placeholder, and (for
    // multi-hole templates) installs its own Tab/Escape tabstop keymap.
    snippet(item.template)(view, null, this.from, head);
    this.clear();
    view.focus();
  }

  clear() {
    this.items = [];
  }
}

export const completions = new CompletionStore();
