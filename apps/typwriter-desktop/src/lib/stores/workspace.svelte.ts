import { err, ResultAsync } from 'neverthrow';
import {
    getFileTree, setMainFile, createFile, createFolder,
    deleteFile, deleteFolder, renameFile, moveFile, moveFolder, openFolder, importFiles
} from '$lib/ipc/commands';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { onWorkspaceFileChanged } from '$lib/ipc/events';
import type { FileTreeEntry } from '$lib/types';
import { editor } from './editor.svelte';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: FileNode[];
    expanded: boolean;
    isEditing: boolean;
    editName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalize(path: string): string {
    return path.replace(/\\/g, '/');
}

export function basename(path: string): string {
    return normalize(path).split('/').pop() ?? path;
}

export function dirname(path: string): string {
    const n = normalize(path);
    const idx = n.lastIndexOf('/');
    return idx >= 0 ? n.slice(0, idx) : '';
}

function entryToNode(entry: FileTreeEntry, expandedPaths: Set<string>): FileNode {
    const path = normalize(entry.path);
    return {
        name: entry.name,
        path,
        is_dir: entry.is_dir,
        expanded: expandedPaths.has(path),
        isEditing: false,
        editName: '',
        children: entry.children.map(c => entryToNode(c, expandedPaths)),
    };
}

function collectExpandedPaths(nodes: FileNode[], result: Set<string> = new Set()): Set<string> {
    for (const node of nodes) {
        if (node.is_dir && node.expanded) result.add(node.path);
        collectExpandedPaths(node.children, result);
    }
    return result;
}

export function filterTree(nodes: FileNode[], query: string): FileNode[] {
    if (!query.trim()) return nodes;
    const q = query.toLowerCase();
    return nodes.flatMap(node => {
        if (node.is_dir) {
            const filteredChildren = filterTree(node.children, query);
            if (filteredChildren.length > 0) {
                return [{ ...node, expanded: true, children: filteredChildren }];
            }
            if (node.name.toLowerCase().includes(q)) {
                return [{ ...node, expanded: true }];
            }
            return [];
        }
        return node.name.toLowerCase().includes(q) ? [node] : [];
    });
}

function walkAndSetExpanded(nodes: FileNode[], value: boolean): void {
    for (const node of nodes) {
        if (node.is_dir) {
            node.expanded = value;
            walkAndSetExpanded(node.children, value);
        }
    }
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
        if (node.path === path) return node;
        const found = findNode(node.children, path);
        if (found) return found;
    }
    return null;
}

// ─── Store ────────────────────────────────────────────────────────────────────

class WorkspaceStore {
    tree = $state<FileNode[]>([]);
    rootPath = $state<string | null>(null);
    mainFile = $state<string | null>(null);
    activeFilePath = $state<string | null>(null);
    searchQuery = $state('');
    dragSrcPath = $state<string | null>(null);

    filteredTree = $derived(filterTree(this.tree, this.searchQuery));

    /** Convert a workspace-relative path to an absolute path. Already-absolute paths are returned as-is. */
    toAbs(path: string): string {
        if (!this.rootPath) return path;
        const p = normalize(path);
        if (/^([A-Za-z]:\/|\/)/.test(p)) return p;
        return `${this.rootPath}/${p}`;
    }

    init(root: string): ResultAsync<void, string> {
        this.rootPath = normalize(root);

        // Register file-change listener; errors are only logged
        onWorkspaceFileChanged(() => {
            this.refreshTree().mapErr(err =>
                console.error('refreshTree after file-change failed:', err)
            );
        }).mapErr(err => console.error('onWorkspaceFileChanged listener failed:', err));

        // Open the workspace in the backend. The backend returns the workspace-relative
        // path of the previously-set main file (if any), which we apply to the store.
        return openFolder(root)
            .andThen((restoredMain) => {
                if (restoredMain) {
                    this.mainFile = normalize(restoredMain);
                }
                return this.refreshTree();
            });
    }

    refreshTree(): ResultAsync<void, string> {
        return getFileTree().map(entries => {
            const expandedPaths = collectExpandedPaths(this.tree);
            this.tree = entries.map(e => entryToNode(e, expandedPaths));
        });
    }

    /** Open a file: activate its tab (or create one) and keep activeFilePath in sync. */
    openFile(path: string): ResultAsync<void, string> {
        this.activeFilePath = path;
        return editor.openFile(path);
    }

    setMainFileAction(path: string): ResultAsync<void, string> {
        const ext = path.split('.').pop()?.toLowerCase();
        const error = err(`Only .typ files can be set as main file, but got .${ext}`);
        if (ext !== 'typ') {
            return ResultAsync.fromPromise(Promise.reject(error.error), () => error.error);
        }
        return setMainFile(this.toAbs(path)).map(() => {
            this.mainFile = path;
        });
    }

    createFileAction(path: string): ResultAsync<void, string> {
        return createFile(this.toAbs(path)).andThen(() => this.refreshTree());
    }

    createFolderAction(path: string): ResultAsync<void, string> {
        return createFolder(this.toAbs(path)).andThen(() => this.refreshTree());
    }

    deleteFileAction(path: string): ResultAsync<void, string> {
        return deleteFile(this.toAbs(path)).andThen(() => {
            const normPath = normalize(path);
            if (editor.tabs.find(t => t.id === normPath)) {
                editor.closeTab(normPath);
            }
            if (this.activeFilePath === path) this.activeFilePath = null;
            return this.refreshTree();
        });
    }

    deleteFolderAction(path: string): ResultAsync<void, string> {
        return deleteFolder(this.toAbs(path)).andThen(() => {
            // Close any tabs whose files live inside the deleted folder.
            const prefix = normalize(path) + '/';
            for (const tab of [...editor.tabs]) {
                if (tab.relPath.startsWith(prefix)) editor.closeTab(tab.id);
            }
            if (this.activeFilePath?.startsWith(path + '/')) {
                this.activeFilePath = null;
            }
            return this.refreshTree();
        });
    }

    renameAction(src: string, newName: string): ResultAsync<void, string> {
        const dir = dirname(src);
        const dst = dir ? `${dir}/${newName}` : newName;
        console.log("Renaming", src, "to", dst);
        return renameFile(this.toAbs(src), this.toAbs(dst)).andThen(() => {
            // Update the open tab path if the renamed file was open.
            const normSrc = normalize(src);
            if (editor.tabs.find(t => t.id === normSrc)) {
                editor.updateTabPath(normSrc, dst);
            }
            if (this.activeFilePath === src) this.activeFilePath = dst;
            if (this.mainFile === src) this.mainFile = dst;
            return this.refreshTree();
        });
    }

    moveAction(src: string, dst: string, is_dir: boolean): ResultAsync<void, string> {
        const op = is_dir ? moveFolder(this.toAbs(src), this.toAbs(dst)) : moveFile(this.toAbs(src), this.toAbs(dst));
        return op.andThen(() => this.refreshTree());
    }

    async importFilesAction(destDir: string): Promise<void> {
        const selected = await openDialog({ multiple: true, directory: false });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length === 0) return;
        const result = await importFiles(paths, this.toAbs(destDir));
        if (result.isOk()) {
            await this.refreshTree();
        }
        return result.match(
            () => { },
            (err) => { throw new Error(err); }
        );
    }

    toggleFolder(path: string): void {
        const node = findNode(this.tree, path);
        if (node?.is_dir) node.expanded = !node.expanded;
    }

    expandAll(): void {
        walkAndSetExpanded(this.tree, true);
    }

    collapseAll(): void {
        walkAndSetExpanded(this.tree, false);
    }
}

export const workspace = new WorkspaceStore();
