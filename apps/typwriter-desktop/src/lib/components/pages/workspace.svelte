<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import DiffOverlay from "$lib/components/vcs/diff-overlay.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { vcs } from "$lib/stores/vcs.svelte";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import { onPreviewSourceJump } from "$lib/ipc/events";
  import { logError } from "$lib/logger";

  const PREVIEW_WINDOW_LABEL = "preview";

  let previewVisible = $state(settings.defaultPreviewVisible);

  const paneVisible = $derived(previewVisible && !preview.poppedOut);

  const workspaceName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : "Typwriter"
  );
  const openedName = $derived(
    workspace.activeFilePath ? workspace.activeFilePath.replaceAll("/", "  /  ") : undefined
  );

  let popoutCloseUnlisten: (() => void) | null = null;
  let sourceJumpUnlisten: (() => void) | null = null;

  async function openPreviewPopout(presentAfterOpen = false) {
    if (preview.poppedOut) return;

    const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
    if (existing) {
      preview.poppedOut = true;
      try {
        await existing.setFocus();
      } catch (err) {
        logError("preview popout focus failed:", err);
      }
      return;
    }

    // Seed the popout's page via the URL: its cross-window state only learns
    // the current page asynchronously (ask/reply over the event bus), and the
    // popout must know where to restore to before its first render.
    const popoutParams = new URLSearchParams({
      window: "preview",
      page: String(preview.visiblePage),
    });
    if (presentAfterOpen) popoutParams.set("present", "1");

    const popout = new WebviewWindow(PREVIEW_WINDOW_LABEL, {
      url: `/?${popoutParams}`,
      title: "Typwriter Preview",
      width: 720,
      height: 900,
      minWidth: 360,
      minHeight: 480,
      decorations: true,
      resizable: true,
    });

    popout.once("tauri://created", () => {
      preview.poppedOut = true;
    });

    popout.once("tauri://error", (event) => {
      logError("preview popout creation failed:", event.payload);
      preview.poppedOut = false;
    });

    popoutCloseUnlisten?.();
    popout
      .onCloseRequested(() => {
        preview.poppedOut = false;
        popoutCloseUnlisten?.();
        popoutCloseUnlisten = null;
      })
      .then((unlisten) => {
        popoutCloseUnlisten = unlisten;
      })
      .catch((err) => logError("preview popout close listener failed:", err));
  }

  function openPresentationMode() {
    openPreviewPopout(true);
  }

  onMount(() => {
    diagnostics.init();
    preview.init().catch((err) => logError("preview init failed:", err));

    onPreviewSourceJump(({ path, offset }) => {
      if (!workspace.rootPath) return;
      const relPath = workspace.toRel(path);
      editor
        .openFile(relPath)
        .map(() => editor.requestCursorJump(relPath, offset))
        .mapErr((err) => logError("preview source-jump failed:", err));
    })
      .map((unlisten) => {
        sourceJumpUnlisten = unlisten;
      })
      .mapErr((err) => logError("preview source-jump listener failed:", err));

    WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL)
      .then((existing) => {
        if (!existing) return;
        preview.poppedOut = true;
        existing
          .onCloseRequested(() => {
            preview.poppedOut = false;
            popoutCloseUnlisten?.();
            popoutCloseUnlisten = null;
          })
          .then((unlisten) => {
            popoutCloseUnlisten = unlisten;
          })
          .catch((err) => logError("preview popout close listener failed:", err));
      })
      .catch((err) => logError("preview popout lookup failed:", err));
  });
  onDestroy(() => {
    diagnostics.destroy();
    preview.destroy();
    popoutCloseUnlisten?.();
    popoutCloseUnlisten = null;
    sourceJumpUnlisten?.();
    sourceJumpUnlisten = null;
  });
</script>

<Sidebar.Provider class="has-titlebar h-full w-full min-h-0 flex-col overflow-hidden">
  <Titlebar
    variant="workspace"
    title={workspaceName}
    subtitle={openedName}
    bind:previewVisible
    previewPoppedOut={preview.poppedOut}
    onTogglePreview={() => (previewVisible = !previewVisible)}
    onPopoutPreview={openPreviewPopout}
  />

  <div class="flex min-h-0 w-full flex-1">
    <AppSidebar />
    <main class="relative flex h-full min-w-0 flex-1 overflow-hidden">
      <!-- Diff overlay (mounted on demand by the history pane) -->
      {#if vcs.diffPaneOpen}
        <DiffOverlay />
      {/if}

      <Resizable.PaneGroup direction="horizontal" class="h-full w-full">
        <Resizable.Pane defaultSize={paneVisible ? 60 : 100} minSize={30}>
          <EditorPane />
        </Resizable.Pane>

        {#if paneVisible}
          <Resizable.Handle />

          <Resizable.Pane defaultSize={40} minSize={30} maxSize={60}>
            <div class="h-full border-l border-border bg-background">
              <Preview onPresentationMode={openPresentationMode} />
            </div>
          </Resizable.Pane>
        {/if}
      </Resizable.PaneGroup>
    </main>
  </div>
</Sidebar.Provider>
