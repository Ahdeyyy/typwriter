<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import CommandPalette from "$lib/components/palette/command-palette.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { grammar } from "$lib/stores/grammar.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { vcs } from "$lib/stores/vcs.svelte";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import { lspClient } from "$lib/lsp/client.svelte";
  import {
    onPreviewSourceJump,
    onVcsRestoreFileRequest,
    emitVcsRestoreFileResult,
    emitPresentationToggleRequest,
  } from "$lib/ipc/events";
  import { closeDiffWindow } from "$lib/windows";
  import { logError } from "$lib/logger";
  import { ui } from "$lib/stores/ui.svelte";
  import { matchesCommand } from "$lib/keybindings";
  import { page } from "$lib/stores/page.svelte";
  import { toast } from "svelte-sonner";

  const PREVIEW_WINDOW_LABEL = "preview";

  let previewVisible = $state(settings.defaultPreviewVisible);

  const paneVisible = $derived(previewVisible && !preview.poppedOut);

  // Let the preview store skip cursor-sync work while nothing displays it.
  $effect(() => {
    preview.paneVisible = paneVisible;
  });

  const workspaceName = $derived(
    workspace.rootPath ? basename(workspace.rootPath) : "Typwriter"
  );
  const openedName = $derived(
    workspace.activeFilePath ? workspace.activeFilePath.replaceAll("/", "  /  ") : undefined
  );

  let popoutCloseUnlisten: (() => void) | null = null;
  let sourceJumpUnlisten: (() => void) | null = null;
  let restoreRequestUnlisten: (() => void) | null = null;

  // Start/stop tinymist as the setting or workspace root changes. `reconcile`
  // is idempotent and handles both toggling and root changes (tear down before
  // reconnecting).
  $effect(() => {
    lspClient.reconcile(settings.useLsp, workspace.rootPath);
  });

  async function openPreviewPopout(presentAfterOpen = false) {
    // The live window is the source of truth, not the `poppedOut` flag: a
    // popout closed outside our listener would otherwise wedge this off.
    const existing = await WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL);
    if (existing) {
      preview.poppedOut = true;
      // The popout is already up, so `?present=1` is no longer available —
      // ask the window that owns the presentation to toggle it. Focusing it
      // would drag it off the projector, so only do that when we're merely
      // surfacing the popout.
      if (presentAfterOpen) {
        emitPresentationToggleRequest().mapErr((err) =>
          logError("preview present toggle request failed:", err)
        );
        return;
      }
      try {
        await existing.setFocus();
      } catch (err) {
        logError("preview popout focus failed:", err);
      }
      return;
    }
    // No window under that label — a stale flag from a close we missed.
    preview.poppedOut = false;

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
      decorations: false,
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
        preview.presenting = false;
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

  // ── Command palette ───────────────────────────────────────────────────────

  async function returnHome() {
    const result = await workspace.leave();
    result.match(
      () => page.navigate("home"),
      (err) => {
        logError("Failed to return home:", err);
        toast.error(`Failed to return home: ${err}`);
      },
    );
  }

  // `toggleSidebar` is missing on purpose: the palette supplies it from
  // `useSidebar()`, which only resolves inside the provider below.
  const paletteContext = {
    togglePreview: () => (previewVisible = !previewVisible),
    popoutPreview: () => void openPreviewPopout(),
    startPresentation: openPresentationMode,
    returnHome: () => void returnHome(),
  };

  function onWindowKeydown(event: KeyboardEvent) {
    // Both default to a `Mod-p` chord, which the WebView would otherwise hand
    // to its print dialog.
    if (matchesCommand(event, "global.commandPalette")) {
      event.preventDefault();
      ui.togglePalette("commands");
    } else if (matchesCommand(event, "global.quickOpen")) {
      event.preventDefault();
      ui.togglePalette("files");
    }
  }

  onMount(() => {
    diagnostics.init();
    // The grammar store is loaded and kept in sync in +layout.svelte (every
    // window needs it). What it can't reach from there are the open buffers,
    // so this is where it learns what a config change has to re-check.
    grammar.openBuffers = () =>
      editor.tabs
        .filter((tab) => tab.viewMode === "text" && !tab.isLoading)
        .map((tab) => ({ relPath: tab.relPath, text: tab.content }));
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

    // Single-file restores initiated from the standalone diff window are
    // executed here: the editor tabs that must be flushed before — and
    // reloaded after — the restore live in this window's stores. The outcome
    // goes back over the event bus so the diff window can toast + reload.
    onVcsRestoreFileRequest(async ({ pointId, path }) => {
      const result = await vcs.restoreSingleFile(pointId, path);
      emitVcsRestoreFileResult({
        path,
        error: result.isErr() ? result.error : null,
      }).mapErr((err) => logError("vcs restore-file result emit failed:", err));
    })
      .map((unlisten) => {
        restoreRequestUnlisten = unlisten;
      })
      .mapErr((err) => logError("vcs restore-file listener failed:", err));

    WebviewWindow.getByLabel(PREVIEW_WINDOW_LABEL)
      .then((existing) => {
        if (!existing) return;
        preview.poppedOut = true;
        existing
          .onCloseRequested(() => {
            preview.poppedOut = false;
            // The window that owned the presentation is going away; clear the
            // shared flag or this window's Present button stays stuck on
            // "exit" with nothing left to exit.
            preview.presenting = false;
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
    lspClient.destroy();
    diagnostics.destroy();
    grammar.openBuffers = null;
    grammar.destroy();
    preview.destroy();
    popoutCloseUnlisten?.();
    popoutCloseUnlisten = null;
    sourceJumpUnlisten?.();
    sourceJumpUnlisten = null;
    restoreRequestUnlisten?.();
    restoreRequestUnlisten = null;
    // The diff window shows this workspace's history — it has no subject once
    // the workspace closes.
    void closeDiffWindow();
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

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

  <CommandPalette ctx={paletteContext} />
</Sidebar.Provider>
