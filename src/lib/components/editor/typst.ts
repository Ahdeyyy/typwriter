/// typst support for the editor

// import { autocomplete, tooltip as getTooltipInfo } from "@/ipc";
import { autocomplete, tooltip_info } from "@/commands";
import type { DiagnosticResponse } from "@/types";
import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
// import { getTooltip } from "@codemirror/view";
import type { EditorView } from "codemirror";
import { toast } from "svelte-sonner";

/**
 * Hover tooltip function for Typst
 * Shows documentation and type information when hovering over code
 */
export async function typst_hover_tooltip(
  view: EditorView,
  pos: number,
  side: -1 | 1,
) {
  const sourceText = view.state.doc.toString();

  try {
    const result = await tooltip_info(sourceText, pos);

    if (result.isErr()) {
      console.error("Failed to get tooltip:", result.error);
      toast.error("Failed to get tooltip", {
        description: result.error.message,
      });
      return null;
    }

    const response = result.value;

    // If no tooltip data returned, return null
    if (!response) {
      return null;
    }

    // Create the tooltip DOM element based on the tooltip kind
    const dom = document.createElement("div");
    dom.className = "cm-tooltip-typst";

    if (response.kind === "Code") {
      // For code tooltips, use a code block style
      const pre = document.createElement("pre");
      pre.textContent = response.text;
      pre.style.margin = "0";
      pre.style.padding = "4px 8px";
      pre.style.fontFamily = "monospace";
      dom.appendChild(pre);
    } else {
      // For text tooltips, use regular text
      const p = document.createElement("p");
      p.textContent = response.text;
      p.style.margin = "0";
      p.style.padding = "4px 8px";
      dom.appendChild(p);
    }

    return {
      pos,
      end: pos,
      above: true,
      create: () => ({ dom }),
    };
  } catch (error) {
    console.error("Error in typst_hover_tooltip:", error);
    toast.error("Error fetching tooltip information");
    return null;
  }
}

export async function typst_completion(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  // Get the document text and cursor position
  const sourceText = context.state.doc.toString();
  const cursorPosition = context.pos;

  // Check if this is an explicit completion request (e.g., Ctrl+Space)
  const explicit = context.explicit;
  // console.log("getting completion")

  const result = await autocomplete(sourceText, cursorPosition, explicit);

  if (result.isErr()) {
    console.error("Failed to get completions:", result.error);
    toast.error("Failed to get completions", {
      description: result.error.message,
    });
    return null;
  }

  const response = result.value;
  // console.log(response);

  // If no completions returned, return null
  if (!response || response.completions.length === 0) {
    return null;
  }

  // Map Typst completion kinds to CodeMirror completion types
  const kindMap: Record<string, string> = {
    Syntax: "keyword",
    Func: "function",
    Type: "type",
    Param: "variable",
    Constant: "constant",
    Symbol: "text",
    Module: "namespace",
    File: "text",
    Folder: "text",
  };

  // Convert Typst completions to CodeMirror completion format
  const options = response.completions.map((comp) => ({
    label: comp.label,
    // Use apply if available, otherwise fall back to label
    apply: comp.apply ?? comp.label,
    type: kindMap[comp.kind] || "text",
    detail: comp.detail ?? undefined,
    // Boost score for more relevant completions
    boost: comp.kind === "Func" ? 1 : 0,
  }));

  return {
    from: response.char_position,
    options: options,
    // Optionally filter completions based on what user has typed
    filter: true,
  };
}

export function typstLinter(diags: DiagnosticResponse[]) {
  return linter((view) => {
    const getHints = (hints: string[]) => {
      if (hints.length === 0) return "";
      return "\n\nHints:\n" + hints.map((h) => ` - ${h}`).join("\n");
    };

    let diagnostics: Diagnostic[] = [];
    for (const diag of diags) {
      diagnostics.push({
        from: flattenLineAndColumn(
          diag.location.line,
          diag.location.column,
          view,
        ),
        to: flattenLineAndColumn(
          diag.location.end_line,
          diag.location.end_column,
          view,
        ),
        message: ` ${diag.message} ${getHints(diag.hints)}`,
        severity: diag.severity.toLocaleLowerCase() as Diagnostic["severity"],
      });
    }
    return diagnostics;
  });
}

function flattenLineAndColumn(
  line: number,
  column: number,
  view: EditorView,
): number {
  // Diagnostics coming from the compiler use 1-based line/column.
  // Prefer using the active CodeMirror document if available for exact offsets;
  // otherwise fall back to the in-memory `app.text` string.
  const l = Math.max(1, Math.floor(line));
  const c = Math.max(1, Math.floor(column));

  // Helper to clamp a value between min and max
  const clamp = (v: number, a: number, b: number) =>
    Math.max(a, Math.min(b, v));

  // Try to use the active EditorView's document (accurate and accounts for CRLF)

  const doc = view.state.doc;
  const totalLines = doc.lines;
  const useLine = clamp(l, 1, totalLines);
  const lineObj = doc.line(useLine);
  // column is 1-based where 1 == first character; allow column to be one past line end
  const maxCol = lineObj.length + 1;
  const useCol = clamp(c, 1, maxCol);
  return lineObj.from + (useCol - 1);
}
