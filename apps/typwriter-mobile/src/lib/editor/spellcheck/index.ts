// Spell checking for Typst buffers, underlined in the editor.
//
// Cheap by construction, because the phone's CPU budget is the constraint:
//   - nothing runs while typing: a check waits for the buffer to sit idle.
//     It does run while the keyboard is composing — Android keyboards keep
//     the word at the caret composing for as long as the caret sits in it, so
//     waiting for composition to end meant never checking at all — but the
//     word being typed is left un-underlined until it's finished, as a
//     keyboard would;
//   - only the prose near the viewport is looked at, a paragraph at a time
//     (`prose.ts`), and each paragraph's answer is cached by its text, so an
//     edit re-checks one paragraph and scrolling back costs nothing;
//   - the checking itself happens in Rust, behind one async command: the
//     bundled dictionary for spelling, the keyboard's spellchecker service
//     for grammar when it has one — see `src-tauri/src/spell.rs`;
//   - one request in flight at a time.
//
// The caret sitting in a flagged word publishes it to the spell store; the
// completion strip turns that into suggestion chips.

import { StateEffect, StateField, type Extension, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { spellCheck } from "#lib/ipc/commands.ts";
import type { SpellIssue } from "#lib/ipc/types.ts";
import { settings } from "#lib/stores/settings.svelte.ts";
import { spell } from "#lib/stores/spell.svelte.ts";
import { chunkRangeToDoc, extractProse, type ProseChunk } from "./prose";

/** A flagged range in the document. */
export interface DocSpellIssue {
  from: number;
  to: number;
  kind: SpellIssue["kind"];
  /** The flagged source text. */
  word: string;
  suggestions: string[] | null;
}

/** Re-derive the underlines now — after the ignored words change. */
export const refreshSpell = StateEffect.define<null>();
const setIssues = StateEffect.define<DocSpellIssue[]>();

/** Quiet time after an edit before a check. */
const IDLE_DELAY_MS = 800;
/** After a scroll or a parse catching up: only cache misses cost anything. */
const SETTLE_DELAY_MS = 250;
const ERROR_RETRY_MS = 5000;
/** How far past the viewport to look, in characters, before widening to the
 *  enclosing paragraphs. */
const VIEWPORT_MARGIN = 3000;
const MAX_PARAGRAPH_SCAN_LINES = 200;
/** One request's share — well under the backend's own cap. */
const BATCH_TEXTS = 40;
const BATCH_UTF16 = 12_000;

// ─── Result cache ───────────────────────────────────────────────────────────
// Keyed by chunk text, shared by every file: the same paragraph needs the same
// answer wherever it is. Oldest-first eviction (Map keeps insertion order).

const CACHE_LIMIT = 4000;
const cache = new Map<string, SpellIssue[]>();

function cached(text: string): SpellIssue[] | undefined {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
  }
  return hit;
}

function remember(text: string, issues: SpellIssue[]) {
  cache.delete(text);
  cache.set(text, issues);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

// ─── Underlines ─────────────────────────────────────────────────────────────

interface SpellFieldValue {
  issues: DocSpellIssue[];
  decorations: DecorationSet;
}

const spellingMark = Decoration.mark({ class: "cm-spell cm-spell-spelling" });
const grammarMark = Decoration.mark({ class: "cm-spell cm-spell-grammar" });

function withDecorations(issues: DocSpellIssue[]): SpellFieldValue {
  return {
    issues,
    decorations: Decoration.set(
      issues.map((i) => (i.kind === "grammar" ? grammarMark : spellingMark).range(i.from, i.to)),
      true,
    ),
  };
}

const spellField = StateField.define<SpellFieldValue>({
  create: () => withDecorations([]),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setIssues)) return withDecorations(e.value);
    if (!tr.docChanged || !value.issues.length) return value;
    // An edit inside a flagged word drops its underline at once (the word is
    // being fixed); the rest follow the text until the next check.
    const issues: DocSpellIssue[] = [];
    for (const issue of value.issues) {
      if (tr.changes.touchesRange(issue.from, issue.to)) continue;
      issues.push({ ...issue, from: tr.changes.mapPos(issue.from, 1), to: tr.changes.mapPos(issue.to, -1) });
    }
    return withDecorations(issues);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

const spellTheme = EditorView.baseTheme({
  ".cm-spell": {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "1px",
    textUnderlineOffset: "3px",
    textDecorationSkipInk: "none",
  },
  ".cm-spell-spelling": { textDecorationColor: "var(--destructive)" },
  ".cm-spell-grammar": { textDecorationColor: "#3b82f6" },
});

/** The flagged range the caret is in (an empty selection touching it). */
export function issueAtCaret(state: EditorState): DocSpellIssue | null {
  const field = state.field(spellField, false);
  const sel = state.selection.main;
  if (!field || !sel.empty) return null;
  return field.issues.find((i) => i.from <= sel.head && sel.head <= i.to) ?? null;
}

// ─── Checking ───────────────────────────────────────────────────────────────

/** The prose chunks around the viewport, widened to whole paragraphs. */
function visibleChunks(view: EditorView): ProseChunk[] {
  const { state } = view;
  const tree = syntaxTree(state);
  const doc = state.doc;
  const limit = Math.min(doc.length, tree.length);
  let from = Math.max(0, view.viewport.from - VIEWPORT_MARGIN);
  let to = Math.min(limit, view.viewport.to + VIEWPORT_MARGIN);
  if (to <= from) return [];

  // Blank lines are paragraph breaks: start and end on one, so the edge
  // chunks are whole and their cache keys stable while scrolling.
  let line = doc.lineAt(from);
  for (let n = 0; n < MAX_PARAGRAPH_SCAN_LINES && line.number > 1 && line.text.trim() !== ""; n++) {
    line = doc.line(line.number - 1);
  }
  from = line.from;
  line = doc.lineAt(to);
  for (let n = 0; n < MAX_PARAGRAPH_SCAN_LINES && line.number < doc.lines && line.text.trim() !== ""; n++) {
    line = doc.line(line.number + 1);
  }
  to = Math.min(limit, line.to);

  return extractProse(tree, (a, b) => doc.sliceString(a, b), from, to);
}

/** Turn cached answers for `chunks` into document issues, leaving out the
 *  one containing `holdBack` (the word being typed), if any. */
function issuesFor(view: EditorView, chunks: ProseChunk[], holdBack: number): DocSpellIssue[] {
  const ignored = new Set(settings.spellIgnoredWords.map((w) => w.toLowerCase()));
  const issues: DocSpellIssue[] = [];
  for (const chunk of chunks) {
    const answer = cached(chunk.text);
    if (!answer) continue;
    for (const issue of answer) {
      const range = chunkRangeToDoc(chunk, issue.start, issue.end);
      if (!range || (range.from <= holdBack && holdBack <= range.to)) continue;
      const word = view.state.doc.sliceString(range.from, range.to);
      if (issue.kind === "spelling" && ignored.has(word.replace(/’/g, "'").toLowerCase())) continue;
      issues.push({ ...range, kind: issue.kind, word, suggestions: issue.suggestions });
    }
  }
  return issues;
}

class SpellChecker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A request is out. Whatever changes meanwhile is picked up by the run
   *  every response schedules. */
  private inFlight = false;
  private destroyed = false;
  /** Where the caret was after the last edit, until it moves for any other
   *  reason. Together with `view.composing`, that's the word being typed —
   *  as opposed to a word the user tapped, which Android keyboards also
   *  compose, and whose underline (and suggestions) must stay. */
  private typingAt = -1;

  constructor(private view: EditorView) {
    this.schedule(SETTLE_DELAY_MS);
  }

  update(u: ViewUpdate) {
    if (u.docChanged) this.typingAt = u.state.selection.main.head;
    else if (u.selectionSet) this.typingAt = -1;
    if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshSpell)))) {
      this.schedule(0, true);
    } else if (u.docChanged) {
      // Typing pushes the check back; nothing else may pull it forward.
      this.schedule(IDLE_DELAY_MS, true);
    } else if (
      u.viewportChanged || u.selectionSet || syntaxTree(u.state) !== syntaxTree(u.startState)
    ) {
      // A caret move can end a composition, which lets the word held back
      // from the last publish show. Cache hits only: this costs no request.
      this.schedule(SETTLE_DELAY_MS);
    }
    if (u.docChanged || u.selectionSet || u.state.field(spellField) !== u.startState.field(spellField)) {
      spell.setActive(issueAtCaret(u.state));
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    spell.setActive(null);
  }

  /** `reset` restarts a pending timer; otherwise a pending one stands. */
  private schedule(delay: number, reset = false) {
    if (this.timer) {
      if (!reset) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run() {
    if (this.destroyed) return;
    if (this.inFlight) return;

    const chunks = visibleChunks(this.view);
    const holdBack = this.view.composing ? this.typingAt : -1;
    this.view.dispatch({ effects: setIssues.of(issuesFor(this.view, chunks, holdBack)) });

    const batch: string[] = [];
    let size = 0;
    for (const chunk of chunks) {
      if (batch.length >= BATCH_TEXTS || size + chunk.text.length > BATCH_UTF16) break;
      if (cached(chunk.text) || batch.includes(chunk.text)) continue;
      batch.push(chunk.text);
      size += chunk.text.length;
    }
    if (!batch.length) return;

    this.inFlight = true;
    const result = await spellCheck(batch);
    this.inFlight = false;
    if (this.destroyed) return;
    result.match(
      (report) => {
        spell.deviceGrammar = report.deviceGrammar;
        report.results.forEach((issues, i) => remember(batch[i]!, issues));
        // Publish what came back, and send the next batch if there is one.
        this.schedule(0, true);
      },
      (err) => {
        console.warn("spellcheck: check failed", err);
        this.schedule(ERROR_RETRY_MS, true);
      },
    );
  }
}

const spellChecker = ViewPlugin.fromClass(SpellChecker);

/** The spell-check extension for a buffer: Typst only (the prose extractor
 *  reads the Typst syntax tree), and only when the setting is on. */
export function spellcheckFor(isTypst: boolean, enabled: boolean): Extension {
  return isTypst && enabled ? [spellField, spellChecker, spellTheme] : [];
}
