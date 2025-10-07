import { readTextFile, create } from "@tauri-apps/plugin-fs";
import { buildFileTreeRel, getFileType, getFolderName, joinFsPath } from "./utils";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { EditorView, lineNumbers, type ViewUpdate, hoverTooltip } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml"
import { basicSetup } from "codemirror";
import { Compartment, type Extension } from "@codemirror/state";
import { ayuLight, } from "thememirror";

import { createScrollbarTheme } from "./utils"
import type { DiagnosticResponse } from "./types"
import { linter, type Diagnostic } from "@codemirror/lint";
import { typst, TypstHighlightSytle } from "codemirror-lang-typst"
import { CompletionContext, type CompletionResult, autocompletion } from "@codemirror/autocomplete"
import { autocomplete, tooltip as getTooltip } from "./ipc"
import { syntaxHighlighting } from "@codemirror/language";


// const recent = new RuneStore('recent_workspaces', { workspaces: [] as { name: string, path: string }[] }, {
//     saveOnChange: true,
//     autoStart: true,
// });

function flattenLineAndColumn(line: number, column: number): number {
    // Diagnostics coming from the compiler use 1-based line/column.
    // Prefer using the active CodeMirror document if available for exact offsets;
    // otherwise fall back to the in-memory `app.text` string.
    const l = Math.max(1, Math.floor(line));
    const c = Math.max(1, Math.floor(column));

    // Helper to clamp a value between min and max
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    // Try to use the active EditorView's document (accurate and accounts for CRLF)
    try {
        // `app` is exported later in this module; accessing it here at call-time is fine
        if (typeof appState !== "undefined" && appState.view && appState.view.state) {
            const doc = appState.view.state.doc;
            const totalLines = doc.lines;
            const useLine = clamp(l, 1, totalLines);
            const lineObj = doc.line(useLine);
            // column is 1-based where 1 == first character; allow column to be one past line end
            const maxCol = lineObj.length + 1;
            const useCol = clamp(c, 1, maxCol);
            return lineObj.from + (useCol - 1);
        }
    } catch (e) {
        // fall through to text fallback
    }

    // Fallback: compute offset from the plain text buffer (`app.text`).
    const text = (typeof appState !== "undefined" && appState.text != null) ? String(appState.text) : "";
    const lines = text.split(/\r\n|\r|\n/);
    const useLine = clamp(l, 1, Math.max(1, lines.length));
    const lineStr = lines[useLine - 1] || "";
    const maxCol = lineStr.length + 1;
    const useCol = clamp(c, 1, maxCol);

    let offset = 0;
    for (let i = 0; i < useLine - 1; i++) {
        // assume original separators were single-character newlines for offset calculation
        offset += lines[i].length + 1;
    }
    offset += useCol - 1;

    return clamp(offset, 0, text.length);
}


class App {
    // The absolute path of the workspace
    workspacePath = $state("")

    workspaceName = $state("")

    // Recently opened workspaces (most recent first)
    recentWorkspaces = $state([] as { name: string; path: string }[])

    // The entries (files and folders) in the directory
    entries = $state<string[] | any[] | string>([])

    text = $state("")
    // The path of the currently opened file - a relative? absolute probably path to the root of the workspace
    // serves as an identifier for the file
    currentFilePath = $state("")

    isPreviewPaneOpen = $state(false)

    isFileTreeOpen = $state(false)

    isDiagnosticsOpen = $state(false)

    newDiagnostics = $state(0)

    renderPosition = $state({ x: 0, y: 0, page: 0 })

    view = $state<EditorView | undefined>(undefined)

    editorExtensions = $state(new Compartment())

    canCompileFile = $state(true)

    zoomLevel = $state(1)

    diagnostics = $state([] as Array<DiagnosticResponse>)

    completions = $state<null | Awaited<ReturnType<typeof typst_completion>>>(null)

    constructor() {

    }

    typstLinter() {
        return linter(view => {

            let diagnostics: Diagnostic[] = []
            for (const diag of this.diagnostics) {
                diagnostics.push({
                    from: flattenLineAndColumn(diag.location.line, diag.location.column),
                    to: flattenLineAndColumn(diag.location.end_line, diag.location.end_column),
                    message: ` ${diag.message} \n hint: ${diag.hints.join("\n")}`,
                    severity: diag.severity.toLocaleLowerCase() as Diagnostic["severity"],
                })
            }
            return diagnostics
        })
    }

    async openWorkspace(): Promise<boolean> {
        const folder = await open({
            multiple: false,
            directory: true
        })

        if (folder) {
            const name = getFolderName(folder);
            try {
                await invoke('open_workspace', {
                    path: folder
                })
            } catch (e) {
                console.error("[ERROR] - opening workspace: ", e)
            }
            this.workspacePath = folder;
            this.workspaceName = name;

            const tree = await buildFileTreeRel(folder)
            this.entries = tree

            // Maintain recent list (remove existing then unshift)
            this.recentWorkspaces = [
                { name, path: folder },
                ...this.recentWorkspaces.filter(w => w.path !== folder)
            ]

            return true
        }
        return false
    }

    /**
     * Open a workspace from the recent list without prompting the dialog
     */
    async openRecentWorkspace(path: string) {
        if (!path) return;
        const name = getFolderName(path);
        try {
            await invoke('open_workspace', { path });
        } catch (e) {
            console.error('[ERROR] - opening recent workspace: ', e);
        }
        this.workspacePath = path;
        this.workspaceName = name;
        try {
            const tree = await buildFileTreeRel(path);
            this.entries = tree;
        } catch (e) {
            console.error('[ERROR] - building file tree for recent workspace: ', e);
        }
        // Reorder recent list
        this.recentWorkspaces = [
            { name, path },
            ...this.recentWorkspaces.filter(w => w.path !== path)
        ];
    }


    loadEditor(view: EditorView) {
        this.view = view
    }

    async moveEditorCursor(bytePosition: number) {
        if (!this.view) return;
        const charPosition = bytePosition;
        const transaction = this.view.state.update({
            selection: { anchor: charPosition, head: charPosition },
            scrollIntoView: true,
        });
        this.view.dispatch(transaction);
        this.view.focus();
    }

    async openFile(file: string): Promise<boolean> {
        const path = joinFsPath(this.workspacePath, file)
        this.currentFilePath = path
        // console.log(this.currentFilePath)
        try {
            await invoke('open_file', {
                file_path: path
            })
        } catch (e) {
            console.error("[ERROR] - opening file: ", e)
        }

        try {
            const contents = await readTextFile(path)
            this.text = contents

        } catch (e) {
            console.error("[ERROR] - error reading file contents: ", e)
        }

        if (getFileType(file) === "typ") {
            this.canCompileFile = true
        } else {
            this.canCompileFile = false
        }


        if (this.view) {
            const tr = this.view.state.update({
                changes: {
                    from: 0,
                    to: this.view.state.doc.length,
                    insert: this.text,
                },
                // This is an important step to prevent the change from being merged with
                // the previous undo history. Setting a user event prevents this.
                userEvent: "replace-document",
            })

            this.view.dispatch(tr)

            const fixedHeight = EditorView.theme({
                "&": { height: "95svh" },
                ".cm-scroller": { overflow: "auto" },
            })

            const editorWidth = EditorView.theme({
                "&": { width: "100%" },
            })
            const scrollbarTheme = createScrollbarTheme({})

            const extensions: Extension[] = []

            extensions.push(lineNumbers())
            extensions.push(ayuLight)
            extensions.push(EditorView.lineWrapping)
            extensions.push(basicSetup)
            extensions.push(fixedHeight)
            extensions.push(editorWidth)
            extensions.push(scrollbarTheme)

            if (getFileType(file) === "yaml" || getFileType(file) === "yml") {
                extensions.push(yaml())
            }

            if (getFileType(file) === "typ") {
                const typstExtension = typst()

                extensions.push(
                    typstExtension
                )
                extensions.push(this.typstLinter())
                extensions.push(syntaxHighlighting(TypstHighlightSytle))
                // Add custom autocomplete for Typst
                extensions.push(autocompletion({
                    override: [typst_completion],
                    activateOnTyping: true,
                }))
                // Add hover tooltips for Typst
                extensions.push(hoverTooltip(typst_hover_tooltip))
            }

            this.view.dispatch({
                effects: this.editorExtensions.reconfigure(extensions)
            })

        }


        return false;
    }

    // Create a new file in the current workspace
    // TODO: add a dialog to enter the file name
    async createNewFile() {
        if (!this.workspacePath) return;
        const adj = ['brave', 'cowardly', 'eager', 'fancy', 'gentle', 'happy', 'jolly', 'kind', 'lucky', 'merry', 'nice', 'proud', 'silly', 'witty', 'zealous']
        const noun = ['apple', 'banana', 'carrot', 'date', 'eggplant', 'fig', 'grape', 'honeydew', 'kiwi', 'lemon', 'mango', 'nectarine', 'orange', 'papaya', 'quince']
        const randAdj = adj[Math.floor(Math.random() * adj.length)]
        const randNoun = noun[Math.floor(Math.random() * noun.length)]
        const randNum = Math.floor(Math.random() * 1000)
        const fileName = `${randAdj}_${randNoun}_${randNum}.typ`
        const path = joinFsPath(this.workspacePath, fileName)
        const file = await create(path);
        if (file) {
            // Refresh the file tree
            const tree = await buildFileTreeRel(this.workspacePath)
            this.entries = tree
            // Open the newly created file
            await this.openFile(fileName)
        }
    }

}

/**
 * Hover tooltip function for Typst
 * Shows documentation and type information when hovering over code
 */
async function typst_hover_tooltip(view: EditorView, pos: number, side: -1 | 1) {
    const sourceText = view.state.doc.toString();

    try {
        const result = await getTooltip(sourceText, pos);

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


async function typst_completion(context: CompletionContext): Promise<CompletionResult | null> {
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

// Flow
// listners for  previews and diagnostics will be attached
// Type in the editor 
// After debounce the text is sent for compilation
// when compilation is done the pages of the document is sent to the preview handler
// when compilation is done the diagnostic are sent to the handler

export const appState = new App()
