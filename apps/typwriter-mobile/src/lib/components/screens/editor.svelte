<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { SidebarLeft01Icon, EyeIcon, Alert01Icon } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { pageForCursor } from "#lib/ipc/commands.ts";
  import { app } from "#lib/stores/app.svelte.ts";
  import { editor } from "#lib/stores/editor.svelte.ts";
  import { compileStore } from "#lib/stores/compile.svelte.ts";
  import { keyboard } from "#lib/editor/keyboard-visibility.svelte.ts";
  import { Skeleton } from "#lib/components/ui/skeleton/index.ts";
  import TreeSheet from "#lib/components/file-tree/tree-sheet.svelte";
  import EditorHost from "#lib/components/editor/editor-host.svelte";
  import EditorToolbar from "#lib/components/toolbar/editor-toolbar.svelte";
  import CompletionStrip from "#lib/components/toolbar/completion-strip.svelte";
  import PreviewOverlay from "#lib/components/preview/preview-overlay.svelte";
  import EmptyTab from "#lib/components/editor/empty-tab.svelte";
  import BottomBar from "#lib/components/toolbar/bottom-bar.svelte";
  import QuickSwitcher from "#lib/components/screens/quick-switcher.svelte";
  import TabSwitcher from "#lib/components/screens/tab-switcher.svelte";
  import TabBar from "#lib/components/toolbar/tab-bar.svelte";
  import { layout } from "#lib/stores/layout.svelte.ts";
  import { immersive } from "#lib/stores/immersive.svelte.ts";
  import { workspace } from "#lib/stores/workspace.svelte.ts";
  import SyncIndicator from "#lib/components/sync-indicator.svelte";
  import { fade } from "svelte/transition";
  import { easeOut } from "#lib/motion.ts";

  onMount(() => {
    // Let the history/back integration flush unsaved content when leaving.
    app.flushEditor = () => {
      // Where the caret sits is part of what "leaving the editor" should
      // capture — the debounced persist may still be pending.
      editor.persistTabsNow();
      void editor.flush();
    };
    keyboard.init();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        editor.persistTabsNow();
        void editor.flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      app.flushEditor = null;
      keyboard.destroy();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // Immersive chrome comes back whenever the context changes under it: the
  // keyboard opening (typing always has the header and toolbar; also so it
  // doesn't vanish again the moment the keyboard closes) or another file
  // opening at its top.
  $effect(() => {
    if (keyboard.visible) immersive.reveal("editor");
  });
  $effect(() => {
    void editor.relPath;
    immersive.reveal("editor");
  });

  /** Page the preview should land on, resolved from the caret while opening. */
  let previewStartPage = $state<number | null>(null);

  async function openPreview() {
    // Wide tablets toggle the docked pane instead of covering the editor.
    if (layout.wide) {
      layout.previewPinned = !layout.previewPinned;
      if (!layout.previewPinned) return;
      await editor.flush();
      if (compileStore.stale) await compileStore.run();
      return;
    }
    previewStartPage = null;
    app.openOverlay("preview"); // opens immediately (skeleton / last pages)
    await editor.flush(); // persist current text
    if (compileStore.stale) await compileStore.run();
    // Only meaningful against the document we just compiled, hence after the
    // run; a null result (caret in code, or nothing rendered) leaves the
    // preview at the top.
    previewStartPage = await cursorPage();
  }

  /** Ask the compiler which page the caret renders on. */
  async function cursorPage(): Promise<number | null> {
    const view = editor.view;
    if (!view || editor.fileKind !== "text" || !editor.relPath) return null;
    const cursor = view.state.selection.main.head;
    return pageForCursor(editor.relPath, cursor).unwrapOr(null);
  }

  let formatting = $state(false);

  async function formatFile() {
    if (formatting) return;
    formatting = true;
    const result = await editor.formatActive();
    formatting = false;
    result.mapErr((e) => toast.error(`Format failed: ${e}`));
  }

  // A folder workspace's sync changing state (started, syncing, synced,
  // paused, lost the folder) must be seen: bring the floating header — and the
  // indicator in it — back if scrolling had hidden it.
  $effect(() => {
    const state = workspace.sync?.state;
    // Only the sync state is a dependency — reading the immersive state here
    // would re-reveal the header every time scrolling hides it.
    if (state) untrack(() => immersive.reveal("editor"));
  });
</script>

<!-- Anchored to the top of the layout viewport and shortened by the keyboard
     inset (see keyboard-visibility), so the shell always ends where the soft
     keyboard begins instead of running behind it. `--app-inset-top` pads out
     the part Chrome has scrolled off the top of the screen, which keeps the
     header and the toolbar exactly on the visible band's edges and leaves the
     flexible editor in between as the only thing that resizes. Falls back to a
     full-window box before the keyboard listener publishes the vars.

     Edge to edge: nothing pads the shell for the status or navigation bar. On
     phones the text runs from the top of the screen to the bottom, and the
     header and dock float over it (`--editor-pad-top` keeps the first line
     clear of them). Tablets keep a solid tab-strip header in the flow. -->
<div
  in:fade={{ duration: 200, easing: easeOut }}
  class="fixed inset-x-0 top-0 flex flex-col"
  style:height="var(--app-height, 100svh)"
  style:padding-top="var(--app-inset-top, 0px)"
  style:--editor-pad-top={layout.tablet
    ? "0.75rem"
    : "calc(var(--safe-top) + var(--float-header-h) + 0.75rem)"}
>
  {#if layout.tablet}
    <header
      class="bg-background/70 shrink-0 border-b backdrop-blur-md"
      style="padding-top: calc(var(--safe-top) + 0.5rem);"
    >
      <TabBar onPreview={openPreview} onFormat={formatFile} />
    </header>
    {@render banners(false)}
  {/if}

  <!-- Wide tablets dock the file tree and the preview on either side of the
       editor; elsewhere both are overlays and the editor has the full width.
       The keyboard toolbars stay in the editor column, under the text they
       act on. -->
  <div class="flex min-h-0 flex-1">
    {#if layout.sidebarDocked}
      <TreeSheet docked />
    {/if}

    <div class="relative flex min-w-0 flex-1 flex-col">
      <main class="min-h-0 flex-1">
        {#if editor.loading}
          <div class="flex flex-col gap-2 p-4" style:padding-top="var(--editor-pad-top)">
            {#each [0, 1, 2, 3, 4, 5, 6, 7] as id (id)}
              <Skeleton class="h-4 w-full" />
            {/each}
          </div>
        {:else if editor.fileKind === "image" && editor.imageDataUrl}
          <div class="flex h-full items-center justify-center overflow-auto p-4">
            <img src={editor.imageDataUrl} alt={editor.fileName} class="max-h-full max-w-full" />
          </div>
        {:else if editor.fileKind === "unsupported"}
          <div class="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
            This file type can't be opened in the editor.
          </div>
        {:else if editor.fileKind === "text"}
          <EditorHost />
        {:else}
          <EmptyTab />
        {/if}
      </main>

      {#if !layout.tablet}
        <!-- Floating header, Obsidian style: no bar, just the buttons over the
             text, under a status-bar-high fade that keeps the clock legible.
             The file's name is the editor's inline title, not a header label.
             Slides away when the user scrolls into the text (immersive). -->
        <div
          class="immersive-top pointer-events-none absolute inset-x-0 top-0 z-20"
          data-hidden={immersive.editorHidden}
          bind:offsetHeight={immersive.editorHeaderHeight}
        >
          <div class="status-scrim"></div>
          <div
            class="flex items-center justify-between gap-2 pt-2"
            style:padding-left="calc(var(--safe-left) + 0.75rem)"
            style:padding-right="calc(var(--safe-right) + 0.75rem)"
          >
            <button
              class="float-btn"
              aria-label="Toggle files"
              onclick={() => (app.overlay === "filetree" ? app.closeOverlay() : app.openOverlay("filetree"))}
            >
              <Icon icon={SidebarLeft01Icon} class="size-5" />
            </button>

            <div class="flex items-center gap-2">
              <SyncIndicator floating />
              {#if compileStore.errors.length > 0}
                <button
                  class="float-pill text-destructive flex h-11 items-center gap-1.5 px-3.5 text-sm font-semibold tabular-nums"
                  aria-label="{compileStore.errors.length} errors"
                  onclick={() => app.openOverlay("diagnostics")}
                >
                  <Icon icon={Alert01Icon} class="size-[18px]" />
                  {compileStore.errors.length}
                </button>
              {/if}
              <button class="float-btn" aria-label="Preview" onclick={openPreview}>
                <Icon icon={EyeIcon} class="size-5" />
              </button>
            </div>
          </div>
          {@render banners(true)}
        </div>
      {/if}

      <!-- Toolbar: keyboard-open form (formatting) vs keyboard-closed dock.
           Tablets have no dock — the tab bar carries its commands. The phone
           dock floats over the text and hides with the header. -->
      {#if keyboard.visible && editor.fileKind === "text" && !editor.loading}
        <CompletionStrip />
        <EditorToolbar />
      {:else if !layout.tablet}
        <div
          class="immersive-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20"
          data-hidden={immersive.editorHidden}
        >
          <BottomBar onFormat={formatFile} />
        </div>
      {/if}
    </div>

    {#if layout.previewDocked}
      <div class="w-[42%] max-w-[40rem] shrink-0">
        <PreviewOverlay docked />
      </div>
    {/if}
  </div>
</div>

<!-- The open file was rewritten on disk while this buffer had unsaved edits.
     Shown rather than resolved automatically: autosave makes "dirty" a window
     of a few seconds, and throwing away what the user typed inside it is the
     one outcome that loses work. A clean buffer never reaches this — it has
     already reloaded itself. On phones it floats under the header as a card
     (and keeps the chrome from hiding until it's answered). -->
{#snippet banners(floating: boolean)}
  {#if editor.externallyChanged}
    <div
      class="text-foreground flex shrink-0 items-center gap-2 px-3 py-2 text-xs {floating
        ? 'float-pill mx-3 mt-2 rounded-2xl'
        : 'bg-destructive/10'}"
      role="status"
    >
      <Icon icon={Alert01Icon} class="text-destructive shrink-0" />
      <span class="min-w-0 flex-1">Changed on disk since you started editing.</span>
      <Button variant="ghost" size="sm" onclick={() => editor.keepMyChanges()}>Keep mine</Button>
      <Button variant="secondary" size="sm" onclick={() => void editor.reloadActiveFromDisk()}>
        Reload
      </Button>
    </div>
  {:else if editor.saveError}
    <div
      class="flex shrink-0 items-center gap-2 px-3 py-2 text-xs {floating
        ? 'float-pill mx-3 mt-2 rounded-2xl'
        : 'bg-destructive/10'}"
      role="status"
    >
      <span class="min-w-0 flex-1">Unsaved changes: {editor.saveError}</span>
      <Button variant="secondary" size="sm" onclick={() => void editor.flush()}>Retry</Button>
    </div>
  {/if}
{/snippet}

{#if !layout.sidebarDocked}
  <TreeSheet />
{/if}
<PreviewOverlay startPage={previewStartPage} />
<QuickSwitcher />
<TabSwitcher />
