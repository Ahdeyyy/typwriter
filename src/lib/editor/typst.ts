/// typst support for the editor

import { autocomplete, tooltip as getTooltipInfo } from "@/ipc";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
// import { getTooltip } from "@codemirror/view";
import type { EditorView } from "codemirror";


/**
 * Hover tooltip function for Typst
 * Shows documentation and type information when hovering over code
 */
export async function typst_hover_tooltip(view: EditorView, pos: number, side: -1 | 1) {
    const sourceText = view.state.doc.toString();

    try {
        const result = await getTooltipInfo(sourceText, pos);

        if (result.isErr()) {
            console.error("Failed to get tooltip:", result.error);
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
            create: () => ({ dom })
        };
    } catch (error) {
        console.error("Error in typst_hover_tooltip:", error);
        return null;
    }
}


export async function typst_completion(context: CompletionContext): Promise<CompletionResult | null> {
    // Get the document text and cursor position
    const sourceText = context.state.doc.toString();
    const cursorPosition = context.pos;

    // Check if this is an explicit completion request (e.g., Ctrl+Space)
    const explicit = context.explicit;
    console.log("getting completion")

    const result = await autocomplete(sourceText, cursorPosition, explicit)

    if (result.isErr()) {
        console.error("Failed to get completions:", result.error);
        return null;
    }

    const response = result.value;
    console.log(response);

    // If no completions returned, return null
    if (!response || response.completions.length === 0) {
        return null;
    }

    // Map Typst completion kinds to CodeMirror completion types
    const kindMap: Record<string, string> = {
        "Syntax": "keyword",
        "Func": "function",
        "Type": "type",
        "Param": "variable",
        "Constant": "constant",
        "Symbol": "text",
        "Module": "namespace",
        "File": "text",
        "Folder": "text",
    };

    // Convert Typst completions to CodeMirror completion format
    const options = response.completions.map(comp => ({

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
