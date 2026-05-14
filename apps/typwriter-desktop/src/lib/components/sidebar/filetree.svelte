<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    FilePlusIcon,
    FolderAddIcon,
    UnfoldLessIcon,
    FileImportIcon,
    FileExportIcon,
  } from "@hugeicons/core-free-icons";
  import { ChevronsUpDownIcon } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import {
    workspace,
    basename,
    dirname,
    type FileNode,
  } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import { exportWorkspaceWithPicker } from "$lib/services/export-service";
  import { toast } from "svelte-sonner";
  import { FileTree } from "@pierre/trees";
  import type {
    ContextMenuItem,
    ContextMenuAnchorRect,
    FileTreeDirectoryHandle,
    FileTreeDropResult,
    FileTreeItemHandle,
    FileTreeRenameEvent,
  } from "@pierre/trees";

  function asDir(item: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
    return item && item.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
  }

  // ─── DOM mount / instance ────────────────────────────────────────────

  let treeMount = $state<HTMLDivElement | null>(null);
  let tree: FileTree | null = null;
  let currentPaths: string[] = [];
  let expandedDirs = $state(new Set<string>());

  // Tracks placeholder paths created via `tree.add()` for context-menu
  // creates so `onRename` can route them to `createFile/Folder` instead of
  // `rename`.
  const pendingCreatePaths = new Set<string>();

  // ─── Path helpers ────────────────────────────────────────────────────

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
    return paths.filter((p) => p.endsWith("/"));
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
    return p.endsWith("/") ? p.slice(0, -1) : p;
  }

  // ─── Sync expansion + active selection ───────────────────────────────

  function captureExpandedFromTree(): string[] {
    if (!tree) return [];
    const result: string[] = [];
    for (const p of dirPaths(currentPaths)) {
      const dir = asDir(tree.getItem(p));
      if (dir?.isExpanded()) result.push(p);
    }
    return result;
  }

  function refreshExpandedDirs(): void {
    if (!tree) return;
    const set = new Set<string>();
    for (const p of dirPaths(currentPaths)) {
      const dir = asDir(tree.getItem(p));
      if (dir?.isExpanded()) set.add(p);
    }
    expandedDirs = set;
  }

  function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  function ancestorDirsOf(path: string): string[] {
    const out: string[] = [];
    const norm = path.replace(/\\/g, "/");
    let i = norm.indexOf("/");
    while (i !== -1) {
      out.push(`${norm.slice(0, i)}/`);
      i = norm.indexOf("/", i + 1);
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

  onMount(() => {
    if (!treeMount) return;
    const initialPaths = flattenPaths(workspace.tree);
    currentPaths = initialPaths;

    tree = new FileTree({
      paths: initialPaths,
      icons: { set: "complete", colored: true },
      search: true,
      initialSelectedPaths: workspace.activeFilePath
        ? [workspace.activeFilePath]
        : [],
      initialExpandedPaths: initialExpandedFromTabs(),
      renderRowDecoration: ({ item }) => {
        if (item.kind === "directory") return null;
        if (workspace.mainFile === stripSlash(item.path)) {
          return { text: "●", title: "Main file" };
        }
        return null;
      },
      dragAndDrop: {
        canDrop: ({ target }) =>
          target.kind === "directory" || target.kind === "root",
        onDropComplete: handleDropComplete,
        onDropError: (error) => toast.error(`Move failed: ${error}`),
      },
      renaming: {
        onRename: handleRenameOrCreate,
        onError: (error) => toast.error(`Rename failed: ${error}`),
      },
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: platform.isMobile ? "both" : "right-click",
          buttonVisibility: platform.isMobile ? "always" : "when-needed",
          onOpen: (item, ctx) => {
            menuState = {
              item,
              rect: ctx.anchorRect,
              close: ctx.close,
            };
          },
          onClose: () => {
            menuState = null;
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
        if (p.endsWith("/")) return;
        if (pendingCreatePaths.has(p)) return;
        if (p === workspace.activeFilePath) return;
        workspace
          .openFile(p)
          .mapErr((err) => toast.error(`Failed to open file: ${err}`));
      },
    });

    tree.render({ containerWrapper: treeMount });
    tree.subscribe(refreshExpandedDirs);
  });

  onDestroy(() => {
    tree?.cleanUp();
    tree = null;
  });

  // ─── Reactivity: workspace.tree → pierre paths ───────────────────────

  $effect(() => {
    const newPaths = flattenPaths(workspace.tree);
    if (!tree) return;
    if (pathsEqual(newPaths, currentPaths)) return;

    const expanded = captureExpandedFromTree();
    currentPaths = newPaths;
    tree.resetPaths(newPaths, { initialExpandedPaths: expanded });

    if (workspace.activeFilePath) {
      tree.getItem(workspace.activeFilePath)?.select();
    }
    refreshExpandedDirs();
  });

  $effect(() => {
    const active = workspace.activeFilePath;
    if (!tree || !active) return;
    const selected = tree.getSelectedPaths();
    if (selected.length === 1 && selected[0] === active) return;
    tree.getItem(active)?.select();
  });

  // Re-render decorations when main file changes so the "main" marker moves.
  $effect(() => {
    workspace.mainFile;
    if (!tree) return;
    tree.setComposition(tree.getComposition());
  });

  // Update context-menu trigger mode when viewport switches between mobile and desktop.
  $effect(() => {
    const isMobile = platform.isMobile;
    if (!tree) return;
    const current = tree.getComposition() ?? {};
    tree.setComposition({
      ...current,
      contextMenu: {
        ...(current.contextMenu ?? {}),
        triggerMode: isMobile ? "both" : "right-click",
        buttonVisibility: isMobile ? "always" : "when-needed",
      },
    });
  });

  // ─── Toolbar: expand / collapse all ──────────────────────────────────

  const anyFolderExpanded = $derived(expandedDirs.size > 0);

  function expandAll() {
    if (!tree) return;
    for (const p of dirPaths(currentPaths)) {
      asDir(tree.getItem(p))?.expand();
    }
  }

  function collapseAll() {
    if (!tree) return;
    for (const p of dirPaths(currentPaths)) {
      asDir(tree.getItem(p))?.collapse();
    }
  }

  // ─── Toolbar: root-level inline create ───────────────────────────────

  let creatingRoot = $state<"file" | "folder" | null>(null);
  let newRootName = $state("");
  let rootCreateInputEl = $state<HTMLInputElement | null>(null);
  let blurGuardUntil = $state(0);

  // Mobile-only: shadcn Dialog state for create operations. The inline
  // rename UI used by @pierre/trees doesn't handle the mobile keyboard
  // reliably, so on mobile we collect the name in a dialog and call the
  // workspace actions directly.
  let mobileDialogOpen = $state(false);
  let mobileDialogKind = $state<"file" | "folder">("file");
  let mobileDialogParent = $state(""); // "" = workspace root
  let mobileDialogName = $state("");
  let mobileDialogSubmitting = $state(false);

  async function startRootCreate(kind: "file" | "folder") {
    if (platform.isMobile) {
      openMobileCreateDialog("", kind);
      return;
    }
    creatingRoot = kind;
    newRootName = "";
    await tick();
    blurGuardUntil = Date.now() + 80;
    rootCreateInputEl?.focus();
  }

  function openMobileCreateDialog(parent: string, kind: "file" | "folder") {
    mobileDialogKind = kind;
    mobileDialogParent = parent;
    mobileDialogName = "";
    mobileDialogOpen = true;
  }

  async function submitMobileCreate() {
    if (mobileDialogSubmitting) return;
    const name = mobileDialogName.trim();
    if (!name || !workspace.rootPath) return;
    const kind = mobileDialogKind;
    const parent = mobileDialogParent;
    const targetPath = parent ? `${parent}/${name}` : name;

    mobileDialogSubmitting = true;
    const result = await (kind === "folder"
      ? workspace.createFolderAction(targetPath)
      : workspace.createFileAction(targetPath));
    mobileDialogSubmitting = false;

    result.match(
      () => {
        mobileDialogOpen = false;
        mobileDialogName = "";
      },
      (err) => toast.error(`Create failed: ${err}`),
    );
  }

  function handleMobileDialogKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitMobileCreate();
    }
  }

  async function commitRootCreate() {
    const name = newRootName.trim();
    const kind = creatingRoot;
    creatingRoot = null;
    newRootName = "";
    if (!name || !workspace.rootPath || !kind) return;
    const result = await (kind === "folder"
      ? workspace.createFolderAction(name)
      : workspace.createFileAction(name));
    result.mapErr((err) => toast.error(`Create failed: ${err}`));
  }

  function cancelRootCreate() {
    if (Date.now() < blurGuardUntil) return;
    creatingRoot = null;
    newRootName = "";
  }

  async function importToRoot() {
    try {
      await workspace.importFilesAction("");
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  }

  let exportingWorkspace = $state(false);

  async function exportWorkspace() {
    if (exportingWorkspace) return;
    exportingWorkspace = true;
    try {
      const toastId = toast.loading("Exporting workspace…");
      const result = await exportWorkspaceWithPicker();
      toast.dismiss(toastId);
      if (!result) return;
      result.match(
        (count) =>
          toast.success(
            `Exported ${count} file${count === 1 ? "" : "s"} to selected folder`,
          ),
        (err) => toast.error(`Export failed: ${err}`),
      );
    } catch (err) {
      toast.error(`Export failed: ${err}`);
    } finally {
      exportingWorkspace = false;
    }
  }

  function handleRootCreateKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRootCreate();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelRootCreate();
    }
  }

  // ─── Drag & drop ─────────────────────────────────────────────────────

  async function handleDropComplete(event: FileTreeDropResult) {
    const { draggedPaths, target } = event;
    if (!draggedPaths.length) return;

    const targetDir =
      target.kind === "root"
        ? ""
        : stripSlash(target.directoryPath ?? "");

    for (const dragged of draggedPaths) {
      const src = stripSlash(dragged);
      const isDir = pathIsDir(src);
      if (
        isDir &&
        targetDir &&
        (targetDir === src || targetDir.startsWith(`${src}/`))
      ) {
        continue;
      }
      const dst = targetDir ? `${targetDir}/${basename(src)}` : basename(src);
      if (src === dst) continue;
      const result = await workspace.moveAction(src, dst, isDir);
      result.mapErr((err) => toast.error(`Move failed: ${err}`));
    }
  }

  // ─── Rename & create-via-rename ──────────────────────────────────────

  async function handleRenameOrCreate(event: FileTreeRenameEvent) {
    const sourcePath = event.sourcePath;
    const destPath = event.destinationPath;
    const newName = basename(stripSlash(destPath));
    if (!newName) return;

    if (pendingCreatePaths.has(sourcePath)) {
      pendingCreatePaths.delete(sourcePath);
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

  // ─── Context menu ────────────────────────────────────────────────────

  type MenuState = {
    item: ContextMenuItem;
    rect: ContextMenuAnchorRect;
    close: (options?: { restoreFocus?: boolean }) => void;
  };
  let menuState = $state<MenuState | null>(null);

  function closeMenu(restoreFocus = true) {
    menuState?.close({ restoreFocus });
    menuState = null;
  }

  const menuPath = $derived(menuState ? stripSlash(menuState.item.path) : "");
  const menuIsDir = $derived(menuState?.item.kind === "directory");
  const menuIsMain = $derived(
    menuState !== null &&
      !menuIsDir &&
      workspace.mainFile === menuPath,
  );
  const menuIsTyp = $derived(!menuIsDir && menuPath.endsWith(".typ"));

  function menuOpen() {
    if (!menuState || menuIsDir) return;
    const path = menuPath;
    closeMenu();
    workspace.openFile(path).mapErr((err) =>
      toast.error(`Failed to open file: ${err}`),
    );
  }

  function menuRename() {
    if (!menuState || !tree) return;
    const path = menuState.item.path;
    closeMenu(false);
    tree.startRenaming(path);
  }

  async function menuDelete() {
    if (!menuState) return;
    const isDir = menuIsDir;
    const path = menuPath;
    closeMenu();
    const result = await (isDir
      ? workspace.deleteFolderAction(path)
      : workspace.deleteFileAction(path));
    result.mapErr((err) => toast.error(`Delete failed: ${err}`));
  }

  async function menuSetMain() {
    if (!menuState || menuIsDir) return;
    const path = menuPath;
    closeMenu();
    const result = await workspace.setMainFileAction(path);
    result.mapErr((err) => toast.error(`Set main file failed: ${err}`));
  }

  async function menuFormat() {
    if (!menuState || menuIsDir) return;
    const path = menuPath;
    closeMenu();
    if (!path.endsWith(".typ")) return;
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

  async function menuSave() {
    if (!menuState || menuIsDir) return;
    const path = menuPath;
    closeMenu();
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

  function menuCreateChild(kind: "file" | "folder") {
    if (!menuState || !menuIsDir || !tree) return;
    const dir = menuPath;
    closeMenu(false);
    startCreateInDir(dir, kind);
  }

  async function menuImport() {
    if (!menuState || !menuIsDir) return;
    const dir = menuPath;
    closeMenu();
    try {
      await workspace.importFilesAction(dir);
    } catch (err) {
      toast.error(`Import failed: ${err}`);
    }
  }

  async function startCreateInDir(dir: string, kind: "file" | "folder") {
    if (!tree) return;
    const dirHandle = asDir(tree.getItem(`${dir}/`));
    if (dirHandle && !dirHandle.isExpanded()) dirHandle.expand();

    if (platform.isMobile) {
      openMobileCreateDialog(dir, kind);
      return;
    }

    const placeholderName = kind === "folder" ? "new-folder" : "new-file";
    let placeholder = `${dir}/${placeholderName}${kind === "folder" ? "/" : ""}`;
    let i = 1;
    while (tree.getItem(placeholder)) {
      placeholder = `${dir}/${placeholderName}-${i}${kind === "folder" ? "/" : ""}`;
      i++;
    }

    pendingCreatePaths.add(placeholder);
    tree.add(placeholder);
    const started = tree.startRenaming(placeholder, { removeIfCanceled: true });
    if (!started) {
      pendingCreatePaths.delete(placeholder);
      tree.remove(placeholder, { recursive: true });
    }
  }
</script>

<!-- ─── Toolbar ────────────────────────────────────────────────────── -->
<div
  class="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border px-2 mb-1.5"
>
  <div class="flex items-center gap-0.5 shrink-0">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => (anyFolderExpanded ? collapseAll() : expandAll())}
          >
            {#if anyFolderExpanded}
              <HugeiconsIcon icon={UnfoldLessIcon} class="size-4" />
            {:else}
              <ChevronsUpDownIcon class="size-4" />
            {/if}
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>{anyFolderExpanded ? "Collapse all" : "Expand all"}</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => startRootCreate("file")}
          >
            <HugeiconsIcon icon={FilePlusIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>New file</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={() => startRootCreate("folder")}
          >
            <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>New folder</Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onclick={importToRoot}
          >
            <HugeiconsIcon icon={FileImportIcon} class="size-4" />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Import files to root</Tooltip.Content>
    </Tooltip.Root>
    {#if platform.isMobile}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              onclick={exportWorkspace}
              disabled={exportingWorkspace}
            >
              <HugeiconsIcon icon={FileExportIcon} class="size-4" />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>Export workspace…</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </div>
</div>

<!-- ─── Inline root create input ───────────────────────────────────── -->
{#if creatingRoot}
  <div class="shrink-0 border-b border-sidebar-border px-2 py-1">
    <input
      bind:this={rootCreateInputEl}
      class="h-5 w-full rounded border border-input bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      placeholder={creatingRoot === "folder" ? "folder-name" : "file.typ"}
      bind:value={newRootName}
      onkeydown={handleRootCreateKey}
      onblur={cancelRootCreate}
    />
  </div>
{/if}

<!-- ─── Pierre tree mount ──────────────────────────────────────────── -->
<div
  bind:this={treeMount}
  class="trees-host flex-1 min-h-0"
  style:--trees-theme-sidebar-bg="var(--sidebar)"
  style:--trees-theme-sidebar-fg="var(--sidebar-foreground)"
  style:--trees-theme-sidebar-header-fg="var(--sidebar-foreground)"
  style:--trees-theme-sidebar-border="var(--sidebar-border)"
  style:--trees-theme-list-hover-bg="var(--sidebar-accent)"
  style:--trees-theme-list-active-selection-bg="var(--sidebar-accent)"
  style:--trees-theme-list-active-selection-fg="var(--sidebar-accent-foreground)"
  style:--trees-theme-focus-ring="var(--sidebar-ring)"
  style:--trees-theme-input-bg="var(--background)"
  style:--trees-font-size="12px"
  style:--trees-item-height="26px"
  style:--trees-padding-inline="8px"
  style:--trees-item-padding-x="6px"
></div>

<!-- ─── Custom context menu ────────────────────────────────────────── -->
{#if menuState}
  <div
    class="fixed inset-0 z-40"
    onclick={() => closeMenu()}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeMenu();
    }}
    role="presentation"
  ></div>
  <div
    data-file-tree-context-menu-root="true"
    class="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    style:top="{menuState.rect.y + menuState.rect.height}px"
    style:left="{menuState.rect.x}px"
    role="menu"
  >
    {#if menuIsDir}
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => menuCreateChild("file")}
      >
        New File
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={() => menuCreateChild("folder")}
      >
        New Folder
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={menuImport}
      >
        Import Files…
      </Button>
      <div class="-mx-1 my-1 h-px bg-border"></div>
    {:else}
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={menuOpen}
      >
        Open
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        onclick={menuSave}
      >
        Save Document
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        disabled={!menuIsTyp}
        onclick={menuFormat}
      >
        Format Document
      </Button>
      <Button
        variant="ghost"
        class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
        disabled={menuIsMain}
        onclick={menuSetMain}
      >
        Set as Main File
      </Button>
      <div class="-mx-1 my-1 h-px bg-border"></div>
    {/if}
    <Button
      variant="ghost"
      class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
      onclick={menuRename}
    >
      Rename
    </Button>
    <Button
      variant="destructive"
      class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-xs font-normal"
      onclick={menuDelete}
    >
      Delete
    </Button>
  </div>
{/if}

<!-- ─── Mobile create dialog ───────────────────────────────────────── -->
<Dialog.Root bind:open={mobileDialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {mobileDialogKind === "folder" ? "New Folder" : "New File"}
      </Dialog.Title>
      <Dialog.Description>
        {mobileDialogParent
          ? `Inside ${mobileDialogParent}`
          : "At workspace root"}
      </Dialog.Description>
    </Dialog.Header>

    <div class="py-2">
      <Input
        autofocus
        placeholder={mobileDialogKind === "folder" ? "folder-name" : "file.typ"}
        bind:value={mobileDialogName}
        onkeydown={handleMobileDialogKey}
        disabled={mobileDialogSubmitting}
      />
    </div>

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" disabled={mobileDialogSubmitting}>
            Cancel
          </Button>
        {/snippet}
      </Dialog.Close>
      <Button
        onclick={submitMobileCreate}
        disabled={mobileDialogSubmitting || !mobileDialogName.trim()}
      >
        {mobileDialogSubmitting ? "Creating…" : "Create"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
