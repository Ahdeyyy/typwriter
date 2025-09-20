import { readTextFile, readDir, lstat } from "@tauri-apps/plugin-fs";
import { buildFileTreeRel, getFileType, getFolderName, joinFsPath } from "./utils";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { EditorView, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { yaml } from "@codemirror/lang-yaml"
import { basicSetup } from "codemirror";
import { Compartment, type Extension } from "@codemirror/state";
import { espresso } from "thememirror";
import { createScrollbarTheme } from "./utils"

// const recent = new RuneStore('recent_workspaces', { workspaces: [] as { name: string, path: string }[] }, {
//     saveOnChange: true,
//     autoStart: true,
// });



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

    constructor() {

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
                filePath: path
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
                "&": { height: "94svh" },
                ".cm-scroller": { overflow: "auto" },
            })

            const editorWidth = EditorView.theme({
                "&": { width: "100%" },
            })
            const scrollbarTheme = createScrollbarTheme({})

            const extensions: Extension[] = []

            extensions.push(lineNumbers())
            extensions.push(espresso)
            extensions.push(EditorView.lineWrapping)
            extensions.push(basicSetup)
            extensions.push(fixedHeight)
            extensions.push(editorWidth)
            extensions.push(scrollbarTheme)

            if (getFileType(file) === "yaml" || getFileType(file) === "yml") {
                extensions.push(yaml())
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

export const app = new App()
