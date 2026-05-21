// filetree-controller.svelte.ts
//
// Shared logic for the file tree component. The desktop and mobile variants
// (`filetree.svelte`, `filetree.mobile.svelte`) wire this controller up and
// supply their own rendering — context menu, create-flow, toolbar.
//
// The controller owns the Pierre tree instance, the menu state, and all
// workspace action handlers. Both variants subscribe to `expandedDirs` and
// `menuState` from the same instance so behaviour stays in lockstep.

import { tick } from 'svelte';
import { FileTree } from '@pierre/trees';
import type {
    ContextMenuAnchorRect,
    ContextMenuItem,
    FileTreeDirectoryHandle,
    FileTreeDropResult,
    FileTreeItemHandle,
    FileTreeRenameEvent,
} from '@pierre/trees';
import { toast } from 'svelte-sonner';

import { workspace, type FileNode } from '$lib/stores/workspace.svelte';
import { basename, dirname, normalize } from '$lib/paths';
import { editor } from '$lib/stores/editor.svelte';
import { exportWorkspaceWithPicker } from '$lib/services/export-service';

export type MenuState = {
    item: ContextMenuItem;
    rect: ContextMenuAnchorRect;
    close: (options?: { restoreFocus?: boolean }) => void;
};

export type ContextMenuTriggerMode = 'right-click' | 'both';
export type ContextMenuButtonVisibility = 'always' | 'when-needed';

export interface FiletreeControllerOptions {
    contextMenuTriggerMode: ContextMenuTriggerMode;
    contextMenuButtonVisibility: ContextMenuButtonVisibility;
    /** Called when a new item is being created and the variant should
     *  collect a name from the user (e.g. mobile dialog flow). When
     *  `null`, the controller falls back to Pierre's inline rename. */
    onRequestCreate?: ((parent: string, kind: 'file' | 'folder') => void) | null;
}

function asDir(item: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
    return item && item.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
}

function flattenPaths(nodes: FileNode[], out: string[] = []): string[] {
    for (const n of nodes) {
        if (n.is_dir) {
            out.push(`${n.path}/`);
            flattenPaths(n.children, out);
        } else {
            out.push(n.path);
        }
    }
    return out;
}

function dirPaths(paths: readonly string[]): string[] {
    return paths.filter((p) => p.endsWith('/'));
}

function pathIsDir(path: string): boolean {
    function walk(nodes: FileNode[]): boolean {
        for (const n of nodes) {
            if (n.path === path) return n.is_dir;
            if (walk(n.children)) return true;
        }
        return false;
    }
    return walk(workspace.tree);
}

function stripSlash(p: string): string {
    return p.endsWith('/') ? p.slice(0, -1) : p;
}

function ancestorDirsOf(path: string): string[] {
    const out: string[] = [];
    const norm = normalize(path);
    let i = norm.indexOf('/');
    while (i !== -1) {
        out.push(`${norm.slice(0, i)}/`);
        i = norm.indexOf('/', i + 1);
    }
    return out;
}

function initialExpandedFromTabs(): string[] {
    const set = new Set<string>();
    for (const tab of editor.tabs) {
        for (const dir of ancestorDirsOf(tab.relPath)) set.add(dir);
    }
    if (workspace.activeFilePath) {
        for (const dir of ancestorDirsOf(workspace.activeFilePath)) set.add(dir);
    }
    return [...set];
}

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export class FiletreeController {
    private tree: FileTree | null = null;
    private currentPaths: string[] = [];
    // Placeholder paths created via `tree.add()` so `onRename` can route
    // them to `createFile/Folder` instead of `rename`.
    private pendingCreatePaths = new Set<string>();

    expandedDirs = $state(new Set<string>());
    menuState = $state<MenuState | null>(null);
    exportingWorkspace = $state(false);

    private options: FiletreeControllerOptions;

    constructor(options: FiletreeControllerOptions) {
        this.options = options;
    }

    // ─── Tree lifecycle ──────────────────────────────────────────────────

    mount(container: HTMLDivElement): void {
        const initialPaths = flattenPaths(workspace.tree);
        this.currentPaths = initialPaths;

        this.tree = new FileTree({
            paths: initialPaths,
            icons: { set: 'complete', colored: true },
            search: true,
            initialSelectedPaths: workspace.activeFilePath ? [workspace.activeFilePath] : [],
            initialExpandedPaths: initialExpandedFromTabs(),
            renderRowDecoration: ({ item }) => {
                if (item.kind === 'directory') return null;
                if (workspace.mainFile === stripSlash(item.path)) {
                    return { text: '●', title: 'Main file' };
                }
                return null;
            },
            dragAndDrop: {
                canDrop: ({ target }) => target.kind === 'directory' || target.kind === 'root',
                onDropComplete: (event) => this.handleDropComplete(event),
                onDropError: (error) => toast.error(`Move failed: ${error}`),
            },
            renaming: {
                onRename: (event) => this.handleRenameOrCreate(event),
                onError: (error) => toast.error(`Rename failed: ${error}`),
            },
            composition: {
                contextMenu: {
                    enabled: true,
                    triggerMode: this.options.contextMenuTriggerMode,
                    buttonVisibility: this.options.contextMenuButtonVisibility,
                    onOpen: (item, ctx) => {
                        this.menuState = { item, rect: ctx.anchorRect, close: ctx.close };
                    },
                    onClose: () => {
                        this.menuState = null;
                    },
                },
            },
            unsafeCSS: `
                [data-item-section="decoration"] span {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    line-height: 1;
                    color: #f59e0b;
                }
                [data-file-tree-search-container] {
                    padding-bottom: var(--trees-item-row-gap);
                    border-bottom: 1px solid var(--trees-border-color);
                }
            `,
            onSelectionChange: (paths) => {
                if (paths.length !== 1) return;
                const p = paths[0];
                if (p.endsWith('/')) return;
                if (this.pendingCreatePaths.has(p)) return;
                if (p === workspace.activeFilePath) return;
                workspace
                    .openFile(p)
                    .mapErr((err) => toast.error(`Failed to open file: ${err}`));
            },
        });

        this.tree.render({ containerWrapper: container });
        this.tree.subscribe(() => this.refreshExpandedDirs());
    }

    destroy(): void {
        this.tree?.cleanUp();
        this.tree = null;
    }

    // ─── Reactive sync ───────────────────────────────────────────────────

    syncPaths(): void {
        if (!this.tree) return;
        const newPaths = flattenPaths(workspace.tree);
        if (pathsEqual(newPaths, this.currentPaths)) return;
        const expanded = this.captureExpandedFromTree();
        this.currentPaths = newPaths;
        this.tree.resetPaths(newPaths, { initialExpandedPaths: expanded });
        if (workspace.activeFilePath) {
            this.tree.getItem(workspace.activeFilePath)?.select();
        }
        this.refreshExpandedDirs();
    }

    syncActiveSelection(): void {
        const active = workspace.activeFilePath;
        if (!this.tree || !active) return;
        const selected = this.tree.getSelectedPaths();
        if (selected.length === 1 && selected[0] === active) return;
        // Pierre's per-item `.select()` is additive — clear existing selection first
        // so switching the active file doesn't stack highlights.
        for (const p of selected) {
            if (p !== active) this.tree.getItem(p)?.deselect();
        }
        this.tree.getItem(active)?.select();
    }

    syncMainFileDecoration(): void {
        if (!this.tree) return;
        this.tree.setComposition(this.tree.getComposition());
    }

    setContextMenuMode(
        triggerMode: ContextMenuTriggerMode,
        buttonVisibility: ContextMenuButtonVisibility,
    ): void {
        this.options.contextMenuTriggerMode = triggerMode;
        this.options.contextMenuButtonVisibility = buttonVisibility;
        if (!this.tree) return;
        const current = this.tree.getComposition() ?? {};
        this.tree.setComposition({
            ...current,
            contextMenu: {
                ...(current.contextMenu ?? {}),
                triggerMode,
                buttonVisibility,
            },
        });
    }

    // ─── Toolbar: expand / collapse all ──────────────────────────────────

    get anyFolderExpanded(): boolean {
        return this.expandedDirs.size > 0;
    }

    expandAll(): void {
        if (!this.tree) return;
        for (const p of dirPaths(this.currentPaths)) {
            asDir(this.tree.getItem(p))?.expand();
        }
    }

    collapseAll(): void {
        if (!this.tree) return;
        for (const p of dirPaths(this.currentPaths)) {
            asDir(this.tree.getItem(p))?.collapse();
        }
    }

    // ─── Drag & drop ─────────────────────────────────────────────────────

    private async handleDropComplete(event: FileTreeDropResult): Promise<void> {
        const { draggedPaths, target } = event;
        if (!draggedPaths.length) return;

        const targetDir =
            target.kind === 'root' ? '' : stripSlash(target.directoryPath ?? '');

        for (const dragged of draggedPaths) {
            const src = stripSlash(dragged);
            const isDir = pathIsDir(src);
            if (isDir && targetDir && (targetDir === src || targetDir.startsWith(`${src}/`))) {
                continue;
            }
            const dst = targetDir ? `${targetDir}/${basename(src)}` : basename(src);
            if (src === dst) continue;
            const result = await workspace.moveAction(src, dst, isDir);
            result.mapErr((err) => toast.error(`Move failed: ${err}`));
        }
    }

    // ─── Rename & create-via-rename ──────────────────────────────────────

    private async handleRenameOrCreate(event: FileTreeRenameEvent): Promise<void> {
        const sourcePath = event.sourcePath;
        const destPath = event.destinationPath;
        const newName = basename(stripSlash(destPath));
        if (!newName) return;

        if (this.pendingCreatePaths.has(sourcePath)) {
            this.pendingCreatePaths.delete(sourcePath);
            const parent = dirname(stripSlash(sourcePath));
            const targetPath = parent ? `${parent}/${newName}` : newName;
            const result = await (event.isFolder
                ? workspace.createFolderAction(targetPath)
                : workspace.createFileAction(targetPath));
            result.mapErr((err) => toast.error(`Create failed: ${err}`));
            return;
        }

        const src = stripSlash(sourcePath);
        if (basename(src) === newName) return;
        const result = await workspace.renameAction(src, newName);
        result.mapErr((err) => toast.error(`Rename failed: ${err}`));
    }

    // ─── Context menu derived helpers ────────────────────────────────────

    get menuPath(): string {
        return this.menuState ? stripSlash(this.menuState.item.path) : '';
    }

    get menuIsDir(): boolean {
        return this.menuState?.item.kind === 'directory';
    }

    get menuIsMain(): boolean {
        return (
            this.menuState !== null &&
            !this.menuIsDir &&
            workspace.mainFile === this.menuPath
        );
    }

    get menuIsTyp(): boolean {
        return !this.menuIsDir && this.menuPath.endsWith('.typ');
    }

    closeMenu(restoreFocus = true): void {
        this.menuState?.close({ restoreFocus });
        this.menuState = null;
    }

    // ─── Context menu actions ────────────────────────────────────────────

    menuOpen(): void {
        if (!this.menuState || this.menuIsDir) return;
        const path = this.menuPath;
        this.closeMenu();
        workspace
            .openFile(path)
            .mapErr((err) => toast.error(`Failed to open file: ${err}`));
    }

    menuRename(): void {
        if (!this.menuState || !this.tree) return;
        const path = this.menuState.item.path;
        this.closeMenu(false);
        this.tree.startRenaming(path);
    }

    async menuDelete(): Promise<void> {
        if (!this.menuState) return;
        const isDir = this.menuIsDir;
        const path = this.menuPath;
        this.closeMenu();
        const result = await (isDir
            ? workspace.deleteFolderAction(path)
            : workspace.deleteFileAction(path));
        result.mapErr((err) => toast.error(`Delete failed: ${err}`));
    }

    async menuSetMain(): Promise<void> {
        if (!this.menuState || this.menuIsDir) return;
        const path = this.menuPath;
        this.closeMenu();
        const result = await workspace.setMainFileAction(path);
        result.mapErr((err) => toast.error(`Set main file failed: ${err}`));
    }

    async menuFormat(): Promise<void> {
        if (!this.menuState || this.menuIsDir) return;
        const path = this.menuPath;
        this.closeMenu();
        if (!path.endsWith('.typ')) return;
        const openResult = await workspace.openFile(path);
        if (openResult.isErr()) {
            toast.error(`Failed to open file: ${openResult.error}`);
            return;
        }
        const tabId = editor.activeTabId;
        if (!tabId) return;
        const result = await editor.formatTabById(tabId);
        result.mapErr((err) => toast.error(`Format failed: ${err}`));
    }

    async menuSave(): Promise<void> {
        if (!this.menuState || this.menuIsDir) return;
        const path = this.menuPath;
        this.closeMenu();
        const openResult = await workspace.openFile(path);
        if (openResult.isErr()) {
            toast.error(`Failed to open file: ${openResult.error}`);
            return;
        }
        const tabId = editor.activeTabId;
        if (!tabId) return;
        const result = await editor.saveTabById(tabId);
        result.mapErr((err) => toast.error(`Save failed: ${err}`));
    }

    menuCreateChild(kind: 'file' | 'folder'): void {
        if (!this.menuState || !this.menuIsDir || !this.tree) return;
        const dir = this.menuPath;
        this.closeMenu(false);
        this.startCreateInDir(dir, kind);
    }

    async menuImport(): Promise<void> {
        if (!this.menuState || !this.menuIsDir) return;
        const dir = this.menuPath;
        this.closeMenu();
        try {
            await workspace.importFilesAction(dir);
        } catch (err) {
            toast.error(`Import failed: ${err}`);
        }
    }

    // ─── Create-in-dir ───────────────────────────────────────────────────
    //
    // Variants drive create differently:
    //   - desktop uses Pierre's inline rename via a placeholder path
    //   - mobile collects the name in a Dialog (`onRequestCreate` hook)

    startCreateInDir(dir: string, kind: 'file' | 'folder'): void {
        if (!this.tree) return;
        const dirHandle = asDir(this.tree.getItem(`${dir}/`));
        if (dirHandle && !dirHandle.isExpanded()) dirHandle.expand();

        if (this.options.onRequestCreate) {
            this.options.onRequestCreate(dir, kind);
            return;
        }

        const placeholderName = kind === 'folder' ? 'new-folder' : 'new-file';
        let placeholder = `${dir}/${placeholderName}${kind === 'folder' ? '/' : ''}`;
        let i = 1;
        while (this.tree.getItem(placeholder)) {
            placeholder = `${dir}/${placeholderName}-${i}${kind === 'folder' ? '/' : ''}`;
            i++;
        }

        this.pendingCreatePaths.add(placeholder);
        this.tree.add(placeholder);
        const started = this.tree.startRenaming(placeholder, { removeIfCanceled: true });
        if (!started) {
            this.pendingCreatePaths.delete(placeholder);
            this.tree.remove(placeholder, { recursive: true });
        }
    }

    // ─── Import to root ──────────────────────────────────────────────────

    async importToRoot(): Promise<void> {
        try {
            await workspace.importFilesAction('');
        } catch (err) {
            toast.error(`Import failed: ${err}`);
        }
    }

    // ─── Export workspace ────────────────────────────────────────────────

    async exportWorkspace(): Promise<void> {
        if (this.exportingWorkspace) return;
        this.exportingWorkspace = true;
        try {
            const toastId = toast.loading('Exporting workspace…');
            const result = await exportWorkspaceWithPicker();
            toast.dismiss(toastId);
            if (!result) return;
            result.match(
                (count) =>
                    toast.success(
                        `Exported ${count} file${count === 1 ? '' : 's'} to selected folder`,
                    ),
                (err) => toast.error(`Export failed: ${err}`),
            );
        } catch (err) {
            toast.error(`Export failed: ${err}`);
        } finally {
            this.exportingWorkspace = false;
        }
    }

    // ─── Workspace root inline create (desktop only) ────────────────────

    async startCreateAtRoot(name: string, kind: 'file' | 'folder'): Promise<void> {
        if (!name || !workspace.rootPath) return;
        const result = await (kind === 'folder'
            ? workspace.createFolderAction(name)
            : workspace.createFileAction(name));
        result.mapErr((err) => toast.error(`Create failed: ${err}`));
    }

    // ─── Mobile create dialog submit ────────────────────────────────────

    async submitDialogCreate(parent: string, name: string, kind: 'file' | 'folder') {
        const trimmed = name.trim();
        if (!trimmed || !workspace.rootPath) return null;
        const targetPath = parent ? `${parent}/${trimmed}` : trimmed;
        const result = await (kind === 'folder'
            ? workspace.createFolderAction(targetPath)
            : workspace.createFileAction(targetPath));
        return result;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    private captureExpandedFromTree(): string[] {
        if (!this.tree) return [];
        const result: string[] = [];
        for (const p of dirPaths(this.currentPaths)) {
            const dir = asDir(this.tree.getItem(p));
            if (dir?.isExpanded()) result.push(p);
        }
        return result;
    }

    private refreshExpandedDirs(): void {
        if (!this.tree) return;
        const set = new Set<string>();
        for (const p of dirPaths(this.currentPaths)) {
            const dir = asDir(this.tree.getItem(p));
            if (dir?.isExpanded()) set.add(p);
        }
        this.expandedDirs = set;
    }
}

// Re-export for variant use
export { tick };
