// Error-lens-style inline diagnostics, ported from the desktop app
// (src/lib/codemirror/inline-diagnostics.ts). The desktop version reads the
// @codemirror/lint state; mobile has no lint integration, so this variant owns
// a StateField driven by an effect the editor host dispatches whenever the
// compile store's diagnostics (or the active file) change.
//
// Rendering trick (same as desktop): a line decoration whose message renders
// via `::after` generated content. Generated content is invisible to
// CodeMirror's position/measurement logic, so — unlike an inline widget — the
// caret at end-of-line can never attach itself to the message.

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export type InlineSeverity = "error" | "warning";

export interface InlineDiagnostic {
  /** 0-based start line (matches the IPC `DiagnosticRange.startLine`). */
  line: number;
  severity: InlineSeverity;
  message: string;
}

const severityRank: Record<InlineSeverity, number> = {
  error: 0,
  warning: 1,
};

/** Replace the active set of inline diagnostics for the current document. */
export const setInlineDiagnostics = StateEffect.define<InlineDiagnostic[]>();

interface LineSummary {
  severity: InlineSeverity;
  message: string;
  total: number;
}

function buildDecorations(
  doc: { lines: number; line: (n: number) => { from: number } },
  diags: InlineDiagnostic[],
): DecorationSet {
  // Collapse diagnostics onto their start line: highest severity wins the
  // message slot, the rest become a "(+N)" suffix.
  const byLine = new Map<number, LineSummary>();
  for (const d of diags) {
    // IPC lines are 0-based; CodeMirror lines are 1-based. Clamp stale
    // positions (the buffer may have changed since the last compile).
    const lineNumber = Math.min(Math.max(d.line + 1, 1), doc.lines);
    const existing = byLine.get(lineNumber);
    // Messages can carry newlines; only the first line fits inline.
    const firstLine = d.message.split("\n", 1)[0];
    if (!existing) {
      byLine.set(lineNumber, { severity: d.severity, message: firstLine, total: 1 });
      continue;
    }
    existing.total++;
    if (severityRank[d.severity] < severityRank[existing.severity]) {
      existing.severity = d.severity;
      existing.message = firstLine;
    }
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const lineNumber of [...byLine.keys()].sort((a, b) => a - b)) {
    const summary = byLine.get(lineNumber)!;
    const line = doc.line(lineNumber);
    const text =
      summary.total > 1 ? `${summary.message} (+${summary.total - 1})` : summary.message;
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        attributes: {
          class: `cm-inline-diagnostic cm-inline-diagnostic-${summary.severity}`,
          "data-inline-diagnostic": text,
        },
      }),
    );
  }
  return builder.finish();
}

const inlineDiagnosticsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setInlineDiagnostics)) {
        return buildDecorations(tr.state.doc, e.value);
      }
    }
    // Keep chips glued to their lines while typing; a fresh compile re-sets
    // the whole set shortly after anyway.
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// The message chip mirrors the desktop styling: popover surface, sans 12px
// text, 3px severity-colored left border.
const inlineDiagnosticsTheme = EditorView.baseTheme({
  ".cm-line.cm-inline-diagnostic::after": {
    content: "attr(data-inline-diagnostic)",
    display: "inline-block",
    marginLeft: "3ch",
    padding: "0.125rem 0.75rem",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    fontStyle: "normal",
    fontWeight: "normal",
    lineHeight: "1.45",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid transparent",
    borderRadius: "calc(var(--radius) / 2)",
    whiteSpace: "pre",
    pointerEvents: "none",
    verticalAlign: "middle",
  },
  ".cm-line.cm-inline-diagnostic-error::after": {
    borderLeftColor: "var(--destructive)",
  },
  ".cm-line.cm-inline-diagnostic-warning::after": {
    borderLeftColor: "#f59e0b",
  },
});

/** The extension pair: the diagnostics field plus its chip styling. */
export function inlineDiagnostics() {
  return [inlineDiagnosticsField, inlineDiagnosticsTheme];
}
