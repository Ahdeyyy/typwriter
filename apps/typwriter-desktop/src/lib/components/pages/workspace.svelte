<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as Resizable from "$lib/components/ui/resizable/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { Button } from "$lib/components/ui/button";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { FileCodeIcon, EyeIcon } from "@hugeicons/core-free-icons";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

  import AppSidebar from "$lib/components/sidebar/app-sidebar.svelte";
  import Preview from "$lib/components/sidebar/preview.svelte";
  import PreviewMobile from "$lib/components/sidebar/preview.mobile.svelte";
  import EditorPane from "$lib/components/editor/editor-pane.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import { diagnostics } from "$lib/stores/diagnostics.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { preview } from "$lib/stores/preview.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { workspace, basename } from "$lib/stores/workspace.svelte";
  import { onPreviewSourceJump } from "$lib/ipc/events";
  import { logError } from "$lib/logger";

  const PREVIEW_WINDOW_LABEL = "preview";

  let previewVisible = $state(settings.defaultPreviewVisible);
  let mobileView = $state<"editor" | "preview">("editor");

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
    if (!platform.isDesktop) return;
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

    const popout = new WebviewWindow(PREVIEW_WINDOW_LABEL, {
      url: presentAfterOpen ? "/?window=preview&present=1" : "/?window=preview",
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

    if (platform.isDesktop) {
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
    }
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
      {#if platform.isMobile}
        <!-- Mobile title bar -->
        <div class="absolute inset-x-0 top-0 z-20 flex h-12 items-center justify-between px-2 pointer-events-none">
          <Sidebar.Trigger
            size="icon-lg"
            class="bg-background/30 backdrop-blur-sm shadow-sm rounded-full pointer-events-auto"
          />
          <Button
            variant="ghost"
            size="icon-lg"
            class="bg-background/30 backdrop-blur-sm shadow-sm rounded-full pointer-events-auto"
            onclick={() => (mobileView = mobileView === "editor" ? "preview" : "editor")}
            aria-label={mobileView === "editor" ? "Show preview" : "Show editor"}
          >
            <HugeiconsIcon
              icon={mobileView === "editor" ? EyeIcon : FileCodeIcon}
              class="size-4"
            />
          </Button>
        </div>

        <div class="relative h-full w-full">
          <div class="absolute inset-0" class:hidden={mobileView !== "editor"}>
            <EditorPane />
          </div>
          <div class="absolute inset-0" class:hidden={mobileView !== "preview"}>
            <PreviewMobile visible={mobileView === "preview"} />
          </div>
        </div>
      {:else}
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
      {/if}
    </main>
  </div>
</Sidebar.Provider>
