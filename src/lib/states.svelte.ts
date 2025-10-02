import { readTextFile, readDir, lstat } from "@tauri-apps/plugin-fs";
import { buildFileTreeRel, getFileType, getFolderName, joinFsPath } from "./utils";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { EditorView, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml"
import { basicSetup } from "codemirror";
import { Compartment, type Extension } from "@codemirror/state";
import { espresso, tomorrow, dracula, boysAndGirls, coolGlow, amy, } from "thememirror";
import { githubDark } from '@ddietr/codemirror-themes/github-dark'
import { aura } from '@ddietr/codemirror-themes/aura'
import { tokyoNight } from '@ddietr/codemirror-themes/tokyo-night'
import { tokyoNightDay } from "@ddietr/codemirror-themes/tokyo-night-day"
import { createScrollbarTheme } from "./utils"
import type { DiagnosticResponse } from "./types"
import { linter, type Diagnostic } from "@codemirror/lint";
import { typst } from "codemirror-lang-typst"


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

    constructor() {

    }

    typstLinter() {
        return linter(view => {
            let diagnostics: Diagnostic[] = []
            for (const diag of this.diagnostics) {
                diagnostics.push({
                    from: flattenLineAndColumn(diag.location.line, diag.location.column),
                    to: flattenLineAndColumn(diag.location.end_line, diag.location.end_column),
                    message: diag.message,
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

            return true
        }
        return false
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
                "&": { height: "90svh" },
                ".cm-scroller": { overflow: "auto" },
            })

            const editorWidth = EditorView.theme({
                "&": { width: "100%" },
            })
            const scrollbarTheme = createScrollbarTheme({})

            const extensions: Extension[] = []

            extensions.push(lineNumbers())
            extensions.push(tokyoNight)
            extensions.push(EditorView.lineWrapping)
            extensions.push(basicSetup)
            extensions.push(fixedHeight)
            extensions.push(editorWidth)
            extensions.push(scrollbarTheme)

            if (getFileType(file) === "yaml" || getFileType(file) === "yml") {
                extensions.push(yaml())
            }

            if (getFileType(file) === "typ") {
                extensions.push(typst())
                extensions.push(this.typstLinter())
            }

            this.view.dispatch({
                effects: this.editorExtensions.reconfigure(extensions)
            })


        }


        return false;
    }

}

// Flow
// listners for  previews and diagnostics will be attached
// Type in the editor 
// After debounce the text is sent for compilation
// when compilation is done the pages of the document is sent to the preview handler
// when compilation is done the diagnostic are sent to the handler

export const appState = new App()
