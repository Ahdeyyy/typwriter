import { readTextFile, readDir, lstat } from "@tauri-apps/plugin-fs";
import { buildFileTree, buildFileTreeRel, compile, getFolderName, joinFsPath, saveTextToFile } from "./utils";
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { CodeMirrorEditor } from "./components/codemirror.svelte";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { useDebounce } from "runed";
import Editor from "./components/editor.svelte";


// const recent = new RuneStore('recent_workspaces', { workspaces: [] as { name: string, path: string }[] }, {
//     saveOnChange: true,
//     autoStart: true,
// });

function byteOffsetToCharOffset(text: string, byteOffset: number): number {
    const encoder = new TextEncoder();
    const encodedText = encoder.encode(text.slice(0, byteOffset));
    return encodedText.length;
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

    view = $state<EditorView | undefined>(undefined)

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
            // const dirs = await readDir(folder);

            // for (const dir of dirs) {
            //     // console.log(dir)
            //     if (dir.isFile) {
            //         this.entries.push(dir.name)
            //     }
            // }

            const tree = await buildFileTreeRel(folder)
            this.entries = tree
            console.log(this.entries)
            // recent.update(s => {

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
        }

        // await compile(this.text)

        // if (this.editor.view) {
        //     this.editor.view.destroy()
        // }

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
