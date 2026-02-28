<script lang="ts">
  import { onMount } from "svelte";
  import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
  import { FileCode, BanIcon, PanelLeft } from "@lucide/svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import { toast } from "svelte-sonner";

  import { typst } from "$lib/typst-codemirror-lang/index.js";
  import { tokyoNightDark } from "$lib/typst-codemirror-lang/darkTheme.js";

  import FileTree from "$lib/components/sidebar/filetree.svelte";
  import Preview  from "$lib/components/sidebar/preview.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor }    from "$lib/stores/editor.svelte";

  // ─── CodeMirror setup ────────────────────────────────────────────────────────

  let editorContainer = $state<HTMLDivElement | null>(null);
  let cmView: EditorView | null = null;

  const readOnlyComp = new Compartment();

  // Suppress feedback loop when updating document programmatically
  let suppressUpdate = false;

  onMount(() => {
    if (!editorContainer) return;

    cmView = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
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
          tokyoNightDark,
          readOnlyComp.of(EditorState.readOnly.of(false)),
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
            "&": { height: "100%", fontSize: "13px", fontFamily: "var(--font-mono, monospace)" },
            ".cm-scroller": { overflow: "auto", height: "100%" },
          }),
        ],
      }),
      parent: editorContainer,
    });

    return () => { cmView?.destroy(); cmView = null; };
  });

  // ─── Sync file content into CodeMirror when file path changes ────────────────

  let _trackedFilePath: string | null = null;

  $effect(() => {
    const path    = editor.filePath;
    const content = editor.fileContent;
    const editable = editor.isEditable;

    if (path === _trackedFilePath) return;
    _trackedFilePath = path;

    if (!cmView) return;

    suppressUpdate = true;
    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: content },
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(!editable)),
    });
    suppressUpdate = false;
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

    <Resizable.Handle withHandle />

    <!-- Center: Editor / Viewer -->
    <Resizable.Pane defaultSize={53} minSize={25}>
      <div class="flex h-full flex-col bg-background">
        {#if !editor.filePath}
          <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
            <FileCode class="size-10 opacity-30" />
            <span class="text-sm">Select a file to open</span>
          </div>

        {:else if editor.isLoading}
          <div class="flex h-full items-center justify-center text-muted-foreground text-sm select-none">
            Loading…
          </div>

        {:else if editor.viewMode === "image"}
          <div class="flex h-full items-center justify-center overflow-auto p-4 bg-muted/30">
            <img
              src={editor.imageSrc ?? ""}
              alt={workspace.activeFilePath ?? "image"}
              class="max-w-full max-h-full object-contain rounded shadow-md"
            />
          </div>

        {:else if editor.viewMode === "unsupported"}
          <div class="flex h-full flex-col items-center justify-center gap-2 select-none text-muted-foreground">
            <BanIcon class="size-10 opacity-30" />
            <span class="text-sm">Binary format — preview not available</span>
            <span class="text-xs opacity-50 max-w-xs truncate">{workspace.activeFilePath}</span>
          </div>

        {:else}
          <!-- CodeMirror (text / typst) -->
          <div bind:this={editorContainer} id="editor" class="h-full w-full overflow-hidden"></div>
        {/if}
      </div>
    </Resizable.Pane>

    <Resizable.Handle withHandle />

    <!-- Right: Preview stub -->
    <Resizable.Pane defaultSize={27} minSize={15} maxSize={50}>
      <div class="h-full border-l border-border bg-background">
        <Preview />
      </div>
    </Resizable.Pane>

  </Resizable.PaneGroup>
</div>
