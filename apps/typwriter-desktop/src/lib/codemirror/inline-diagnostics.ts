import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  forEachDiagnostic,
  setDiagnosticsEffect,
  type Diagnostic,
} from "@codemirror/lint";

type Severity = Diagnostic["severity"];

const severityRank: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

interface LineSummary {
  severity: Severity;
  message: string;
  total: number;
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  // Collapse diagnostics onto their start line: highest severity wins the
  // message slot, the rest become a "(+N)" suffix.
  const byLine = new Map<number, LineSummary>();
  forEachDiagnostic(view.state, (d, from) => {
    const line = doc.lineAt(Math.min(from, doc.length));
    const existing = byLine.get(line.number);
    if (!existing) {
      byLine.set(line.number, {
        severity: d.severity,
        // Messages can carry multi-line hints; only the first line fits inline.
        message: d.message.split("\n", 1)[0],
        total: 1,
      });
      return;
    }
    existing.total++;
    if (severityRank[d.severity] < severityRank[existing.severity]) {
      existing.severity = d.severity;
      existing.message = d.message.split("\n", 1)[0];
    }
  });

  const builder = new RangeSetBuilder<Decoration>();
  for (const lineNumber of [...byLine.keys()].sort((a, b) => a - b)) {
    const summary = byLine.get(lineNumber)!;
    const line = doc.line(lineNumber);
    const text =
      summary.total > 1
        ? `${summary.message} (+${summary.total - 1})`
        : summary.message;
    // A line decoration whose message renders via `::after` (see theme below).
    // Generated content is invisible to CodeMirror's position/measurement
    // logic, so — unlike an inline widget — the caret at end-of-line can never
    // attach itself to the message.
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

const inlineDiagnosticsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setDiagnosticsEffect)),
        )
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// The message chip mirrors the lint hover tooltip's diagnostic entry (see the
// `.cm-tooltip-lint .cm-diagnostic` rules in text-editor-tab.svelte): popover
// surface, sans 12px text, 3px severity-colored left border.
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
  ".cm-line.cm-inline-diagnostic-info::after": {
    borderLeftColor: "var(--ring)",
  },
  ".cm-line.cm-inline-diagnostic-hint::after": {
    borderLeftColor: "var(--muted-foreground)",
  },
});

/** Error-lens-style inline diagnostics: renders the first (highest-severity)
 * diagnostic of each line as a tooltip-styled chip at the end of that line.
 * Reads the `@codemirror/lint` state, so it covers both the typst-ide store
 * path (`setDiagnostics`) and tinymist's `serverDiagnostics` extension. */
export function inlineDiagnostics() {
  return [inlineDiagnosticsPlugin, inlineDiagnosticsTheme];
}
