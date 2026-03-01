<script lang="ts">
  import { watch } from "runed";
  import {
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
  } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import {
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
  } from "@codemirror/language";
  import { FileCode, BanIcon, PanelLeft } from "@lucide/svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import { toast } from "svelte-sonner";

  import { typst } from "$lib/typst-codemirror-lang/index.js";
  import { githubLight } from "$lib/typst-codemirror-lang/lightTheme.js";

  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import TabBar from "$lib/components/editor/tab-bar.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor, type TabInfo } from "$lib/stores/editor.svelte";

  // ─── CodeMirror setup ────────────────────────────────────────────────────────

  let editorContainer = $state<HTMLDivElement | null>(null);
  let cmView: EditorView | null = null;

  // Suppress the CM update listener when we're programmatically swapping state.
  let suppressUpdate = false;

  function makeExtensions() {
    return [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      typst(),
      githubLight,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        { key: "Mod-s", run: () => { handleSave(); return true; } },
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppressUpdate) return;
        editor.handleContentChange(update.state.doc.toString());
      }),
      EditorView.theme({
        "&": {
          height: "100svh",
          width: "100%",
          fontSize: "13px",
          fontFamily: "var(--font-mono, monospace)",
        },
        ".cm-scroller": { overflow: "auto"},
      }),
    ];
  }

  // Create/destroy the EditorView reactively when the container div mounts/unmounts.
  // onMount() cannot be used here because editorContainer is inside a conditional
  // block — it's null at mount time when no file is open.
  $effect(() => {
    if (!editorContainer) return;

    cmView = new EditorView({
      state: EditorState.create({ doc: "", extensions: makeExtensions() }),
      parent: editorContainer,
    });

    return () => {
      cmView?.destroy();
      cmView = null;
    };
  });

  // ─── Helper: (re)initialise CM state for a tab ───────────────────────────────

  function initCmStateForTab(tab: TabInfo) {
    if (!cmView) return;
    suppressUpdate = true;
    const s = EditorState.create({ doc: tab.content, extensions: makeExtensions() });
    cmView.setState(s);
    editor.saveCmState(tab.id, s);
    suppressUpdate = false;
  }

  // ─── Tab-switch: save/restore EditorState via runed watch() ─────────────────
  // watch() is used (instead of $effect) because it gives us both the new and
  // previous value — needed to save the leaving tab's CM state.

  watch(
    () => editor.activeTabId,
    (newId, prevId) => {
      if (!cmView) return;

      // Save current CM state for the tab we're leaving.
      if (prevId) {
        editor.saveCmState(prevId, cmView.state);
      }

      if (!newId) return;

      const tab = editor.tabs.find((t) => t.id === newId);
      if (!tab || tab.viewMode !== "text") return;

      // Content not loaded yet — the $effect below will handle it once isLoading → false.
      if (tab.isLoading) return;

      const saved = editor.getCmState(newId);
      if (saved) {
        suppressUpdate = true;
        cmView.setState(saved);
        suppressUpdate = false;
      } else {
        initCmStateForTab(tab);
      }
    },
    { lazy: true }, // Don't fire on initial mount when activeTabId is null.
  );

  // ─── Loading completion: create CM state once content arrives ────────────────
  // This $effect re-runs whenever the active tab or its isLoading flag changes.

  $effect(() => {
    const tab = editor.activeTab;
    // Track reactive deps: tab identity and loading state.
    if (!tab || tab.viewMode !== "text" || tab.isLoading) return;
    // Only act if no CM state exists yet for this tab.
    if (cmView && !editor.getCmState(tab.id)) {
      initCmStateForTab(tab);
    }
  });

  // ─── Sidebar toggle ──────────────────────────────────────────────────────────

  let leftPaneRef = $state<any>(null);
  let sidebarOpen = $state(true);

  function toggleSidebar() {
    sidebarOpen ? leftPaneRef?.collapse() : leftPaneRef?.expand();
  }

  // ─── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    const result = await editor.saveCurrentFile();
    result.mapErr((err) => toast.error(`Save failed: ${err}`));
  }
</script>

<div class="relative flex h-screen w-screen overflow-hidden">
  <!-- Floating re-open button when sidebar is collapsed -->
  {#if !sidebarOpen}
    <button
      class="absolute top-2 left-2 z-50 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      onclick={toggleSidebar}
      title="Show file explorer"
    >
      <PanelLeft class="size-4" />
    </button>
  {/if}

  <Resizable.PaneGroup direction="horizontal" class="h-full w-full">

    <!-- Left: File Explorer -->
    <Resizable.Pane
      bind:this={leftPaneRef}
      collapsible
      collapsedSize={0}
      defaultSize={20}
      minSize={12}
      maxSize={40}
      onCollapse={() => (sidebarOpen = false)}
      onExpand={() => (sidebarOpen = true)}
    >
      <div class="h-full overflow-hidden">
        <FileTree ontoggle={toggleSidebar} />
      </div>
    </Resizable.Pane>

    <Resizable.Handle />

    <!-- Center: Editor / Viewer -->
    <Resizable.Pane defaultSize={53} minSize={25}>
      <div class="flex h-svh flex-col bg-background">

        <!-- Tab bar — only shown when at least one tab is open -->
        {#if editor.tabs.length > 0}
          <TabBar />
        {/if}

        <!-- Content area — flex-1 wrapper gives every branch a concrete height -->
        <div class="relative min-h-0 h-screen flex-1 overflow-hidden">
          {#if !editor.activeTab}
            <!-- Empty state -->
            <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
              <FileCode class="size-10 opacity-30" />
              <span class="text-sm">Select a file to open</span>
            </div>

          {:else if editor.activeTab.isLoading}
            <div class="flex h-full items-center justify-center text-muted-foreground text-sm select-none">
              Loading…
            </div>

          {:else if editor.activeTab.viewMode === "image"}
            <div class="flex h-full items-center justify-center overflow-auto p-4 bg-muted/30">
              <img
                src={editor.activeTab.imageSrc ?? ""}
                alt={editor.activeTab.name}
                class="max-w-full max-h-full object-contain rounded shadow-md"
              />
            </div>

          {:else if editor.activeTab.viewMode === "unsupported"}
            <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
              <BanIcon class="size-10 opacity-30" />
              <span class="text-sm">Binary format — preview not available</span>
              <span class="text-xs opacity-50 max-w-xs truncate">{editor.activeTab.relPath}</span>
            </div>

          {:else}
            <!-- CodeMirror editor (text / typst) -->
            <div
              bind:this={editorContainer}
              id="editor"
              class="h-95svh w-full overflow-hidden"
            ></div>
          {/if}
        </div>

      </div>
    </Resizable.Pane>

    <Resizable.Handle />

    <!-- Right: Preview stub -->
    <Resizable.Pane defaultSize={27} minSize={15} maxSize={50}>
      <div class="h-full border-l border-border bg-background">
        <Preview />
      </div>
    </Resizable.Pane>

  </Resizable.PaneGroup>
</div>


<style>
    :global {
            .codemirror-wrapper {
                width: 100%;
            }
        }
</style>
