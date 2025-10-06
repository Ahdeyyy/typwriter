import { EditorDocument } from "./document.svelte"
import { open_workspace } from "../ipc";
import { getFolderName, joinFsPath } from "../utils";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { open as OpenDialog, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";

const toInvokeError = (): { message: string } => ({ message: "Invoke failed" });
const invoke_open_file = ResultAsync.fromThrowable(
    invoke<void>,
    toInvokeError
);

const safeReadTextFile = ResultAsync.fromThrowable(
    readTextFile,
    () => ({ message: "Failed to read file" })
);


export type FileTreeNode = {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileTreeNode[];
}


export class Workspace {
    document = $state<EditorDocument | null>(null);
    fileEntries = $state<FileTreeNode[]>([]);
    rootPath: string;
    name: string;
    renderedContent = $state<HTMLImageElement[]>([]);


    constructor(path: string) {
        this.rootPath = path;
        this.name = getFolderName(path);
        this.refresh();
    }

    /**
     * Opens a file at the given path
     * @param path - path of the file to open
     * Opens the file at the given path and sets it as the current document
     * If the file is already open, it just focuses on it
     * If the file does not exist, it does nothing
     * If there is an unsaved document, it prompts the user to save it before opening a new file
     */
    async openFile(path: string) {

        if (!this.document) {
            // No document is open, open the file
            const result = await invoke_open_file("open_file", {
                file_path: path
            })

            if (result.isErr()) {
                console.error("Failed to open file:", result.error);
                return;
            }

            const fileContentResult = await safeReadTextFile(path);

            if (fileContentResult.isErr()) {
                console.error("Failed to read file:", fileContentResult.error);
                return;
            }

            const document = new EditorDocument(path);
            document.content = fileContentResult.value;
            await document.compile();

            if (document.compilationStatus === "error") {
                console.error("Failed to compile document");
            }
            if (document.compilationStatus === "success") {
                console.log("Document compiled successfully");
                this.renderedContent = (await document.render()).map(page => {
                    const img = new Image();
                    img.src = `data:image/png;base64,${page.image}`
                    img.width = page.width
                    img.height = page.height
                    return img
                });
            }
            document.compilationStatus = "idle";
            this.document = document;
            return;
        }
        if (this.document.path === path) {
            // File is already open, just focus on it
            return;
        }

        // A different document is open, prompt to save if unsaved
        if (this.document.content !== "") {
            const shouldSave = await confirm("You have unsaved changes. Do you want to save before opening a new file?");
            if (shouldSave) {
                this.document.save();
            }
        }
        // Open the new file
        const result = await invoke_open_file("open_file", {
            file_path: path
        })

        if (result.isErr()) {
            console.error("Failed to open file:", result.error);
            return;
        }
        const fileContentResult = await safeReadTextFile(path);
        if (fileContentResult.isErr()) {
            console.error("Failed to read file:", fileContentResult.error);
            return;
        }

        const document = new EditorDocument(path);
        document.content = fileContentResult.value;
        // $inspect("Document content", document.content);
        await document.compile();
        this.renderedContent = (await document.render()).map(page => {
            const img = new Image();
            img.src = `data:image/png;base64,${page.image}`
            img.width = page.width
            img.height = page.height
            return img
        });
        document.compilationStatus = "idle";
        this.document = document;
    }
    closeFile(path: string) { }
    // creates an empty file at the given path
    createFile(path: string) { }
    deleteFile(path: string) { }
    renameFile(oldPath: string, newPath: string) { }
    createFolder(path: string) { }
    deleteFolder(path: string) { }
    renameFolder(oldPath: string, newPath: string) { }

    /**
     * Refreshes the workspace file tree
     * Rebuilds the file tree from the root path
     * If no root path is set, does nothing
     */
    async refresh() {
        if (!this.rootPath) return;
        this.fileEntries = await buildFileTree(this.rootPath);
    }
}

/**
 * Opens a workspace
 * @param path optional path to the workspace
 * if no path is provided, a new workspace is created
 * if a path is provided, the workspace at that path is opened
 */
export async function openWorkspace(path?: string): Promise<Workspace | undefined> {
    if (path) {
        let res = await open_workspace(path);
        if (res.isErr()) {
            console.error("Failed to open workspace:", res.error);
            return;
        }
        // Set the workspace state
        let workspace = new Workspace(path);
        return workspace;

    } else {
        // Create a new workspace
        const selectedPath = await OpenDialog({ directory: true, multiple: false });
        if (!selectedPath) {
            console.error("No path selected");
            return;
        }
        let workspace = new Workspace(selectedPath);
        return workspace;
    }
}

async function buildFileTree(path: string): Promise<FileTreeNode[]> {
    const tree: FileTreeNode[] = [];
    const entries = await readDir(path);
    for (const entry of entries) {
        if (entry.isDirectory) {
            const children = await buildFileTree(joinFsPath(path, entry.name));
            tree.push({
                name: entry.name,
                path: joinFsPath(path, entry.name),
                type: "directory",
                children
            });
        } else {
            tree.push({
                name: entry.name,
                path: joinFsPath(path, entry.name),
                type: "file"
            });
        }
    }
    return tree;
}

