import { EditorDocument } from "./document.svelte"
import { open_workspace } from "../ipc";
import { getFileType, getFolderName, joinFsPath } from "../utils";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { open as OpenDialog, confirm } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { ResultAsync } from "neverthrow";
import type { RenderResponse } from "@/types";
import { SvelteMap } from "svelte/reactivity"

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

    renderedContent = $state<SvelteMap<number, HTMLImageElement>>(new SvelteMap());
    imageCache = $state(new SvelteMap<string, HTMLImageElement>());


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
            if (getFileType(path) === "typ") {
                await document.compile();

                if (document.compilationStatus === "error") {
                    console.error("Failed to compile document");
                }
                if (document.compilationStatus === "success") {
                    console.log("Document compiled successfully");
                    (await document.render()).map((page, index) => {
                        const img = new Image();
                        img.src = `data:image/png;base64,${page.image}`
                        img.width = page.width
                        img.height = page.height
                        this.renderedContent.set(index, img)
                    });
                }
                document.compilationStatus = "idle";
                // document.getPreviewPosition(0);
            }
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
        if (getFileType(path) === "typ") {
            // console.log("Compiling document...");
            await document.compile();
            (await document.render()).map((page, index) => {
                const img = new Image();
                img.src = `data:image/png;base64,${page.image}`
                img.width = page.width
                img.height = page.height
                this.renderedContent.set(index, img)
            });
            document.compilationStatus = "idle";
            // document.getPreviewPosition(0);
        }
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


    createOrUpdateImage(page: RenderResponse, index: number): HTMLImageElement {
        const cacheKey = `${index}-${murmurHash3(page.image)}`; // Hash for comparison

        let img = this.imageCache.get(cacheKey);
        if (!img) {
            img = new Image();
            img.src = `data:image/png;base64,${page.image}`;
            img.width = page.width;
            img.height = page.height;
            this.imageCache.set(cacheKey, img);
        }
        return img;
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

function hashImageString(image: string): number {
    let hash = 0;
    for (let i = 0; i < image.length; i++) {
        const char = image.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

/**
 * MurmurHash3's 32-bit hashing function.
 * It provides excellent speed and distribution for non-cryptographic needs.
 *
 * @param {string} key The string to hash.
 * @param {number} seed An optional seed value.
 * @returns {number} A 32-bit integer hash.
 */
function murmurHash3(key: string, seed = 0): number {
    let remainder: number, bytes: number, h1: number, h1b: number, c1: number, c2: number, k1: number, i: number;

    remainder = key.length & 3; // key.length % 4
    bytes = key.length - remainder;
    h1 = seed;
    c1 = 0xcc9e2d51;
    c2 = 0x1b873593;
    i = 0;

    while (i < bytes) {
        k1 =
            (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;

        k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
        h1 = (h1b & 0xffffffff) + 0x6b64e653;
    }

    k1 = 0;

    switch (remainder) {
        case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        case 1: k1 ^= (key.charCodeAt(i) & 0xff);
            k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
            h1 ^= k1;
    }

    h1 ^= key.length;
    h1 ^= h1 >>> 16;
    h1 = ((((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16))) & 0xffffffff;
    h1 ^= h1 >>> 13;
    h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
    h1 ^= h1 >>> 16;

    return h1 >>> 0; // Convert to unsigned 32-bit integer
}