<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar/index.js"

  import "../app.css"
  import Button from "@/components/ui/button/button.svelte"
  import {
    LucideDownload,
    LucideEye,
    LucideHamburger,
    LucideMaximize,
    LucideMenu,
    LucideMinimize,
    LucideMinimize2,
    LucideMinus,
    LucideOctagonAlert,
    LucidePanelRight,
    LucidePanelRightClose,
    LucideSquare,
    LucideX,
  } from "@lucide/svelte"
  import { appState } from "@/states.svelte"
  import Diagnostics from "@/components/diagnostics.svelte"
  import { getCurrentWindow } from "@tauri-apps/api/window"
  import { app } from "@tauri-apps/api"
  import { save } from "@tauri-apps/plugin-dialog"
  import { export_to } from "@/ipc"
  import { Toaster } from "$lib/components/ui/sonner/index.js"
  import { Badge } from "@/components/ui/badge"

  let { children } = $props()

  const window = getCurrentWindow()

  let appTitle = $state("")
  let isMaximized = $state(true)

  async function fetchAppTitle() {
    const name = await app.getName()
    const version = await app.getVersion()
    appTitle = `${name}${version}`
  }
  fetchAppTitle()

  const openedFilePath = $derived(
    appState.currentFilePath
      .replace(appState.workspacePath, "")
      .replace(/^\/|\\/, "")
  )

  const export_file_handler = async () => {
    if (!appState.currentFilePath) {
      alert("Please open a file to export.")
      return
    }
    const export_path = await save({
      defaultPath: appState.currentFilePath.replace(/\.[^/.]+$/, ".pdf"),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    })

    if (export_path) {
      let res = await export_to(
        appState.currentFilePath,
        export_path,
        appState.text
      )
    }
  }

  // TODO: add a platform check for Windows, Linux, MacOS and use the appropriate icons for (minimize, maximize, close)
</script>

<Toaster />
<section class="h-screen flex flex-col">
  <header class="flex items-center justify-between">
    <div class="flex gap-2">
      <Button
        size="icon"
        class="w-10 h-8"
        variant="ghost"
        onclick={() => (appState.isFileTreeOpen = !appState.isFileTreeOpen)}
      >
        <LucideMenu />
      </Button>

      <Button
        size="icon"
        class="w-10 h-8"
        variant="ghost"
        onclick={() =>
          (appState.isPreviewPaneOpen = !appState.isPreviewPaneOpen)}
      >
        <LucideEye />
      </Button>

      <Button
        size="icon"
        class="h-8 w-10 relative"
        variant="ghost"
        onclick={() =>
          (appState.isDiagnosticsOpen = !appState.isDiagnosticsOpen)}
      >
        <LucideOctagonAlert />
        {#if appState.diagnostics.length > 0}
          <Badge
            class="h-4 min-w-3 rounded-full px-1 absolute top-0 right-0 font-mono text-xs tabular-nums"
            variant="destructive"
          >
            {appState.diagnostics.length > 99
              ? "99+"
              : appState.diagnostics.length}
          </Badge>
        {/if}
      </Button>

      <Button
        size="icon"
        variant="ghost"
        class="w-10 h-8"
        onclick={export_file_handler}
      >
        <LucideDownload />
      </Button>
    </div>

    <h1 class="font-semibold font-sans">
      {appState.workspaceName}
      {openedFilePath}
      {appTitle}
    </h1>

    <div class="flex gap-0">
      <Button
        size="icon"
        class="w-10 h-8 rounded-none"
        variant="ghost"
        onclick={() => window.minimize()}
      >
        <LucideMinus />
      </Button>

      <Button
        size="icon"
        class="w-10 h-8 rounded-none"
        variant="ghost"
        onclick={async () => {
          const windowIsMaximized = await window.isMaximized()
          if (windowIsMaximized) {
            isMaximized = false
            window.unmaximize()
          } else {
            isMaximized = true
            window.maximize()
          }
        }}
      >
        {#if isMaximized}
          <LucideMinimize2 />
        {:else}
          <LucideSquare />
        {/if}
      </Button>

      <Button
        size="icon"
        class="w-10 h-8 rounded-none hover:bg-red-500"
        variant="ghost"
        onclick={() => window.close()}
      >
        <LucideX />
      </Button>
    </div>
  </header>
  {@render children?.()}
</section>

<style>
  :global {
    html::-webkit-scrollbar {
      display: none;
    }

    /* Hide scrollbar for IE, Edge and Firefox */
    html {
      -ms-overflow-style: none; /* IE and Edge */
      scrollbar-width: none; /* Firefox */
    }
  }
</style>
