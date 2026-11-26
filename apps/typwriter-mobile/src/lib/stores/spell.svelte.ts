// The flagged word under the caret, for the completion strip's suggestion
// chips, plus whether the device checks grammar (shown in Settings). The underlines
// themselves live in the editor (`lib/editor/spellcheck/`).

import type { EditorView } from "@codemirror/view";
import { spellSuggest } from "#lib/ipc/commands.ts";
import type { SpellIssue } from "#lib/ipc/types.ts";
import { settings } from "#lib/stores/settings.svelte.ts";

export interface ActiveSpellIssue {
  from: number;
  to: number;
  kind: SpellIssue["kind"];
  word: string;
  /** `null` while the dictionary's suggestions are being fetched. */
  suggestions: string[] | null;
}

const SUGGESTION_CACHE_LIMIT = 200;

class SpellStore {
  /** Whether the device's spellchecker checked grammar last time; `null`
   *  until the first check. */
  deviceGrammar = $state<boolean | null>(null);
  active = $state.raw<ActiveSpellIssue | null>(null);

  private suggestions = new Map<string, string[]>();
  private seq = 0;

  /** Called by the editor whenever the caret or the underlines move. */
  setActive(issue: ActiveSpellIssue | null) {
    const current = this.active;
    if (
      current && issue && current.from === issue.from && current.to === issue.to &&
      current.word === issue.word && current.kind === issue.kind
    ) {
      return;
    }
    const seq = ++this.seq;
    if (!issue) {
      if (current) this.active = null;
      return;
    }
    const known = issue.suggestions ?? this.suggestions.get(issue.word) ?? null;
    this.active = { ...issue, suggestions: known };
    if (known) return;
    void spellSuggest(issue.word).match(
      (list) => {
        this.suggestions.set(issue.word, list);
        if (this.suggestions.size > SUGGESTION_CACHE_LIMIT) {
          this.suggestions.delete(this.suggestions.keys().next().value!);
        }
        if (seq === this.seq && this.active) this.active = { ...this.active, suggestions: list };
      },
      () => {
        if (seq === this.seq && this.active) this.active = { ...this.active, suggestions: [] };
      },
    );
  }

  /** Replace the flagged word with `text`, if it's still there. */
  apply(view: EditorView, text: string) {
    const issue = this.active;
    if (!issue || view.state.doc.sliceString(issue.from, issue.to) !== issue.word) {
      this.setActive(null);
      return;
    }
    // Same order as accepting a completion: focus, then edit, so the WebView
    // doesn't reveal the caret its own way on top of CodeMirror's scroll.
    view.focus();
    view.dispatch({
      changes: { from: issue.from, to: issue.to, insert: text },
      selection: { anchor: issue.from + text.length },
      userEvent: "input.spellcheck",
      scrollIntoView: true,
    });
  }

  /** "Add to dictionary": stop flagging the word anywhere. */
  ignore() {
    const issue = this.active;
    if (!issue || issue.kind !== "spelling") return;
    settings.addSpellIgnoredWord(issue.word.replace(/’/g, "'"));
    this.setActive(null);
  }
}

export const spell = new SpellStore();
