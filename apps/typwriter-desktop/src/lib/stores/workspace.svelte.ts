import { err, ResultAsync } from 'neverthrow';
import {
    createFile,
    createFolder,
    deleteFile,
    deleteFolder,
    getFileTree,
    importFiles,
    moveFile,
    moveFolder,
    openFolder,
    renameFile,
    setMainFile,
    triggerPreview,
} from '$lib/ipc/commands';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { onWorkspaceFilesChanged, type UnlistenFn } from '$lib/ipc/events';
import type { FileTreeEntry } from '$lib/types';
import { logError } from '$lib/logger';
import { editor } from './editor.svelte';

export interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    children: FileNode[];
    expanded: boolean;
    isEditing: boolean;
    editName: string;
}

export function normalize(path: string): string {
    return path.replace(/\\/g, '/');
}

export function basename(path: string): string {
    return normalize(path).split('/').pop() ?? path;
}

export function dirname(path: string): string {
    const normalized = normalize(path);
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
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
        children: entry.children.map((child) => entryToNode(child, expandedPaths)),
    };
}

function collectExpandedPaths(nodes: FileNode[], result: Set<string> = new Set()): Set<string> {
    for (const node of nodes) {
        if (node.is_dir && node.expanded) {
            result.add(node.path);
        }
        collectExpandedPaths(node.children, result);
    }
    return result;
}

export function filterTree(nodes: FileNode[], query: string): FileNode[] {
    if (!query.trim()) {
        return nodes;
    }
    const q = query.toLowerCase();
    return nodes.flatMap((node) => {
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
        if (node.path === path) {
            return node;
        }
        const found = findNode(node.children, path);
        if (found) {
            return found;
        }
    }
    return null;
}

function rewritePath(path: string, src: string, dst: string, isDir: boolean): string | null {
    const normalizedPath = normalize(path);
    const normalizedSrc = normalize(src).replace(/\/$/, '');
    const normalizedDst = normalize(dst).replace(/\/$/, '');
    if (!isDir) {
        return normalizedPath === normalizedSrc ? normalizedDst : null;
    }
    if (normalizedPath === normalizedSrc) {
        return normalizedDst;
    }
    const prefix = `${normalizedSrc}/`;
    if (!normalizedPath.startsWith(prefix)) {
        return null;
    }
    return `${normalizedDst}/${normalizedPath.slice(prefix.length)}`;
}

class WorkspaceStore {
    tree = $state<FileNode[]>([]);
    rootPath = $state<string | null>(null);
    mainFile = $state<string | null>(null);
    activeFilePath = $state<string | null>(null);
    searchQuery = $state('');
    dragSrcPath = $state<string | null>(null);

    filteredTree = $derived(filterTree(this.tree, this.searchQuery));

    private _filesChangedUnlisten: UnlistenFn | null = null;
    private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

    toAbs(path: string): string {
        if (!this.rootPath) {
            return path;
        }
        const normalized = normalize(path);
        if (/^([A-Za-z]:\/|\/)/.test(normalized)) {
            return normalized;
        }
        return `${this.rootPath}/${normalized}`;
    }

    toRel(absPath: string): string {
        if (!this.rootPath) {
            return absPath;
        }
        const normalized = normalize(absPath);
        const prefix = `${this.rootPath}/`;
        return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    }

    init(root: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._init(root), (err) => String(err));
    }

    leave(): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._leave(), (err) => String(err));
    }

    private async _init(root: string): Promise<void> {
        await editor.flushAllTabs();
        this._disposeFilesChangedListener();
        this._clearRefreshTimer();

        this.rootPath = normalize(root);
        this.tree = [];
        this.mainFile = null;
        this.activeFilePath = null;

        const listenResult = await onWorkspaceFilesChanged(() => {
            this._scheduleTreeRefresh();
        });
        if (listenResult.isOk()) {
            this._filesChangedUnlisten = listenResult.value;
        } else {
            logError('onWorkspaceFilesChanged listener failed:', listenResult.error);
        }

        const openResult = await openFolder(root);
        if (openResult.isErr()) {
            throw new Error(openResult.error);
        }

        if (openResult.value) {
            this.mainFile = normalize(openResult.value);
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    private async _leave(): Promise<void> {
        await editor.flushAllTabs();
        this._disposeFilesChangedListener();
        this._clearRefreshTimer();
        await editor.reset();
        this.tree = [];
        this.rootPath = null;
        this.mainFile = null;
        this.activeFilePath = null;
        this.searchQuery = '';
        this.dragSrcPath = null;
    }

    refreshTree(): ResultAsync<void, string> {
        return getFileTree().map((entries) => {
            const expandedPaths = collectExpandedPaths(this.tree);
            this.tree = entries.map((entry) => entryToNode(entry, expandedPaths));
        });
    }

    openFile(path: string): ResultAsync<void, string> {
        return editor.openFile(path).map(() => {
            this.activeFilePath = path;
        });
    }

    setMainFileAction(path: string): ResultAsync<void, string> {
        const ext = path.split('.').pop()?.toLowerCase();
        const onlyTypError = err(`Only .typ files can be set as main file, but got .${ext}`);
        if (ext !== 'typ') {
            return ResultAsync.fromPromise(Promise.reject(onlyTypError.error), () => onlyTypError.error);
        }

        return setMainFile(this.toAbs(path))
            .andThen(() => triggerPreview('main_file'))
            .map(() => {
                this.mainFile = normalize(path);
            });
    }

    createFileAction(path: string): ResultAsync<void, string> {
        return createFile(this.toAbs(path)).andThen(() => this.refreshTree());
    }

    createFolderAction(path: string): ResultAsync<void, string> {
        return createFolder(this.toAbs(path)).andThen(() => this.refreshTree());
    }

    deleteFileAction(path: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._deleteFile(path), (err) => String(err));
    }

    private async _deleteFile(path: string): Promise<void> {
        const result = await deleteFile(this.toAbs(path));
        if (result.isErr()) {
            throw new Error(result.error);
        }

        const normalized = normalize(path);
        if (editor.tabs.find((tab) => tab.id === normalized)) {
            await editor.closeTab(normalized, { flush: false });
        }
        if (this.activeFilePath === normalized) {
            this.activeFilePath = editor.activeTab?.relPath ?? null;
        }
        if (this.mainFile === normalized) {
            this.mainFile = null;
            triggerPreview('main_file').mapErr((err) => {
                logError('preview trigger after main file delete failed:', err);
            });
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    deleteFolderAction(path: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._deleteFolder(path), (err) => String(err));
    }

    private async _deleteFolder(path: string): Promise<void> {
        const result = await deleteFolder(this.toAbs(path));
        if (result.isErr()) {
            throw new Error(result.error);
        }

        const prefix = `${normalize(path)}/`;
        for (const tab of [...editor.tabs]) {
            if (tab.relPath.startsWith(prefix)) {
                await editor.closeTab(tab.id, { flush: false });
            }
        }

        if (this.activeFilePath?.startsWith(prefix)) {
            this.activeFilePath = editor.activeTab?.relPath ?? null;
        }
        if (this.mainFile?.startsWith(prefix)) {
            this.mainFile = null;
            triggerPreview('main_file').mapErr((err) => {
                logError('preview trigger after main folder delete failed:', err);
            });
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    renameAction(src: string, newName: string): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._renameAction(src, newName), (err) => String(err));
    }

    private async _renameAction(src: string, newName: string): Promise<void> {
        const dir = dirname(src);
        const dst = dir ? `${dir}/${newName}` : newName;

        const result = await renameFile(this.toAbs(src), this.toAbs(dst));
        if (result.isErr()) {
            throw new Error(result.error);
        }

        const normalizedSrc = normalize(src);
        if (editor.tabs.find((tab) => tab.id === normalizedSrc)) {
            editor.updateTabPath(normalizedSrc, dst);
        }
        if (this.activeFilePath === normalizedSrc) {
            this.activeFilePath = normalize(dst);
        }
        const movedMain = this.mainFile === normalizedSrc;
        if (movedMain) {
            this.mainFile = normalize(dst);
        }

        if (movedMain) {
            triggerPreview('main_file').mapErr((err) => {
                logError('preview trigger after main file rename failed:', err);
            });
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    moveAction(src: string, dst: string, is_dir: boolean): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._moveAction(src, dst, is_dir), (err) => String(err));
    }

    private async _moveAction(src: string, dst: string, is_dir: boolean): Promise<void> {
        const result = is_dir
            ? await moveFolder(this.toAbs(src), this.toAbs(dst))
            : await moveFile(this.toAbs(src), this.toAbs(dst));
        if (result.isErr()) {
            throw new Error(result.error);
        }

        if (is_dir) {
            editor.updateTabsUnderPath(src, dst);
        } else {
            const normalizedSrc = normalize(src);
            if (editor.tabs.find((tab) => tab.id === normalizedSrc)) {
                editor.updateTabPath(normalizedSrc, dst);
            }
        }

        this.activeFilePath = this.activeFilePath
            ? rewritePath(this.activeFilePath, src, dst, is_dir) ?? this.activeFilePath
            : null;
        const nextMainFile = this.mainFile
            ? rewritePath(this.mainFile, src, dst, is_dir) ?? this.mainFile
            : null;
        const movedMain = this.mainFile !== nextMainFile;
        this.mainFile = nextMainFile;

        if (movedMain) {
            triggerPreview('main_file').mapErr((err) => {
                logError('preview trigger after moving main path failed:', err);
            });
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    async importFilesAction(destDir: string): Promise<void> {
        const selected = await openDialog({ multiple: true, directory: false });
        if (!selected) {
            return;
        }
        const paths = Array.isArray(selected) ? selected : [selected];
        if (paths.length === 0) {
            return;
        }

        const result = await importFiles(paths, this.toAbs(destDir));
        if (result.isErr()) {
            throw new Error(result.error);
        }

        const refreshResult = await this.refreshTree();
        if (refreshResult.isErr()) {
            throw new Error(refreshResult.error);
        }
    }

    toggleFolder(path: string): void {
        const node = findNode(this.tree, path);
        if (node?.is_dir) {
            node.expanded = !node.expanded;
        }
    }

    expandAll(): void {
        walkAndSetExpanded(this.tree, true);
    }

    collapseAll(): void {
        walkAndSetExpanded(this.tree, false);
    }

    private _scheduleTreeRefresh(): void {
        this._clearRefreshTimer();
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this.refreshTree().mapErr((err) => {
                logError('refreshTree after workspace changes failed:', err);
            });
        }, 120);
    }

    private _clearRefreshTimer(): void {
        if (this._refreshTimer !== null) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    private _disposeFilesChangedListener(): void {
        this._filesChangedUnlisten?.();
        this._filesChangedUnlisten = null;
    }
}

export const workspace = new WorkspaceStore();
