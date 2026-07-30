// Grammar lints as a CodeMirror layer of their own.
//
// Deliberately *not* built on `@codemirror/lint`: that state is already owned
// by the compile pipeline (and by tinymist when the LSP is active), and
// `setDiagnostics` replaces the whole set. Pushing grammar results through it
// would mean the two sources clobber each other on every compile. This keeps
// its own state field, its own decorations, and its own hover panel.

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  type DecorationSet,
  type Tooltip,
} from "@codemirror/view";

import type { GrammarLint, GrammarSuggestion } from "$lib/types";
import { grammarSeverity } from "$lib/stores/grammar.svelte";

/** Replace the grammar lints shown in a view. */
export const setGrammarLints = StateEffect.define<GrammarLint[]>();

/** Actions the hover panel offers beyond applying a suggestion. Supplied by
 *  the editor component so this module stays free of store imports at the
 *  call site. */
export interface GrammarLintHandlers {
  /** "Add to dictionary" — offered for spelling lints only. */
  onAddToDictionary: (word: string) => void;
  /** "Disable this rule" — turns the rule off app-wide. */
  onDisableRule: (rule: string) => void;
}

const markFor = (lint: GrammarLint) =>
  Decoration.mark({
    class: `cm-grammar-lint cm-grammar-lint-${grammarSeverity(lint)}`,
    lint,
  });

/**
 * Build decorations, dropping any lint whose text no longer matches the
 * document.
 *
 * A check runs against a snapshot of the buffer taken up to a second earlier,
 * so by the time it returns the user may have typed past it. Comparing the
 * covered text against what Harper reported is an exact staleness test — a
 * lint that still sits on its own word is still valid wherever it ended up,
 * and one that doesn't simply disappears until the next check.
 */
function buildDecorations(
  state: EditorState,
  lints: GrammarLint[],
): DecorationSet {
  const docLength = state.doc.length;
  const valid = lints
    .filter((lint) => {
      if (lint.start >= lint.end || lint.end > docLength) return false;
      return state.doc.sliceString(lint.start, lint.end) === lint.text;
    })
    // Overlapping marks of the same type crash the tile tree, and Harper can
    // raise two rules against the same span; keep the first (most important,
    // since the backend sorts by priority).
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const ranges = [];
  let lastEnd = -1;
  for (const lint of valid) {
    if (lint.start < lastEnd) continue;
    ranges.push(markFor(lint).range(lint.start, lint.end));
    lastEnd = lint.end;
  }
  return Decoration.set(ranges, true);
}

const grammarLintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setGrammarLints)) {
        decorations = buildDecorations(tr.state, effect.value);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Every lint whose mark covers `pos`, innermost first. */
function lintsAt(
  view: EditorView,
  pos: number,
): { lint: GrammarLint; from: number; to: number }[] {
  const found: { lint: GrammarLint; from: number; to: number }[] = [];
  view.state.field(grammarLintField).between(pos, pos, (from, to, value) => {
    const lint = (value.spec as { lint?: GrammarLint }).lint;
    if (lint) found.push({ lint, from, to });
  });
  return found;
}

function applySuggestion(
  view: EditorView,
  from: number,
  to: number,
  suggestion: GrammarSuggestion,
): void {
  const change =
    suggestion.type === "replace"
      ? { from, to, insert: suggestion.text }
      : suggestion.type === "insert-after"
        ? { from: to, to, insert: suggestion.text }
        : { from, to, insert: "" };
  view.dispatch({ changes: change });
  view.focus();
}

function suggestionLabel(suggestion: GrammarSuggestion): string {
  switch (suggestion.type) {
    case "replace":
      return suggestion.text.trim() === "" ? "(remove space)" : suggestion.text;
    case "insert-after":
      return `add “${suggestion.text}”`;
    case "remove":
      return "remove";
  }
}

function button(
  label: string,
  onClick: () => void,
  className: string,
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return element;
}

function renderPanel(
  view: EditorView,
  entries: { lint: GrammarLint; from: number; to: number }[],
  handlers: GrammarLintHandlers,
): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "cm-grammar-panel";

  for (const { lint, from, to } of entries) {
    const item = document.createElement("div");
    item.className = "cm-grammar-item";

    const header = document.createElement("div");
    header.className = "cm-grammar-header";
    const kind = document.createElement("span");
    kind.className = "cm-grammar-kind";
    kind.textContent = lint.kind.replace(/-/g, " ");
    header.append(kind);
    item.append(header);

    const message = document.createElement("div");
    message.className = "cm-grammar-message";
    message.textContent = lint.message;
    item.append(message);

    if (lint.suggestions.length > 0) {
      const fixes = document.createElement("div");
      fixes.className = "cm-grammar-fixes";
      // More than a handful of spelling candidates is a wall of buttons; the
      // top few are the ones worth showing.
      for (const suggestion of lint.suggestions.slice(0, 5)) {
        fixes.append(
          button(
            suggestionLabel(suggestion),
            () => applySuggestion(view, from, to, suggestion),
            "cm-grammar-fix",
          ),
        );
      }
      item.append(fixes);
    }

    const actions = document.createElement("div");
    actions.className = "cm-grammar-actions";
    if (lint.kind === "spelling" || lint.kind === "typo") {
      actions.append(
        button(
          "Add to dictionary",
          () => handlers.onAddToDictionary(lint.text),
          "cm-grammar-action",
        ),
      );
    }
    actions.append(
      button(
        "Disable this rule",
        () => handlers.onDisableRule(lint.rule),
        "cm-grammar-action",
      ),
    );
    item.append(actions);

    panel.append(item);
  }

  return panel;
}

function grammarHover(handlers: GrammarLintHandlers) {
  return hoverTooltip((view, pos): Tooltip | null => {
    const entries = lintsAt(view, pos);
    if (entries.length === 0) return null;
    return {
      pos: entries[0].from,
      end: entries[0].to,
      above: true,
      create: () => ({ dom: renderPanel(view, entries, handlers) }),
    };
  });
}

// The panel mirrors the lint hover tooltip in `text-editor-tab.svelte`:
// popover surface, 12px sans text, severity-coloured left edge.
const grammarTheme = EditorView.baseTheme({
  ".cm-grammar-lint": {
    textDecoration: "underline wavy",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-grammar-lint-problem": { textDecorationColor: "#ef4444" },
  ".cm-grammar-lint-suggestion": { textDecorationColor: "#3b82f6" },

  ".cm-grammar-panel": {
    maxWidth: "22rem",
    padding: "0.5rem 0.625rem",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    lineHeight: "1.45",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "calc(var(--radius) / 2)",
  },
  ".cm-grammar-item + .cm-grammar-item": {
    marginTop: "0.5rem",
    paddingTop: "0.5rem",
    borderTop: "1px solid var(--border)",
  },
  ".cm-grammar-kind": {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--muted-foreground)",
  },
  ".cm-grammar-message": { marginTop: "0.125rem" },
  ".cm-grammar-fixes": {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
    marginTop: "0.375rem",
  },
  ".cm-grammar-fix": {
    padding: "0.125rem 0.5rem",
    font: "inherit",
    color: "var(--popover-foreground)",
    backgroundColor: "var(--muted)",
    border: "1px solid var(--border)",
    borderRadius: "calc(var(--radius) / 2)",
    cursor: "pointer",
  },
  ".cm-grammar-fix:hover": { backgroundColor: "var(--accent)" },
  ".cm-grammar-actions": {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.625rem",
    marginTop: "0.375rem",
  },
  ".cm-grammar-action": {
    padding: 0,
    font: "inherit",
    fontSize: "11px",
    color: "var(--muted-foreground)",
    background: "none",
    border: "none",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-grammar-action:hover": { color: "var(--popover-foreground)" },
});

/** The grammar-lint layer: underlines plus a hover panel with quick fixes. */
export function grammarLint(handlers: GrammarLintHandlers): Extension {
  return [grammarLintField, grammarHover(handlers), grammarTheme];
}
