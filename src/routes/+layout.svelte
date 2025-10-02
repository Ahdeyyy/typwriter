<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar/index.js"
  import LeftSidebar from "@/components/left-sidebar.svelte"
  import "../app.css"
  import Button from "@/components/ui/button/button.svelte"
  import {
    LucideMaximize,
    LucideMinimize,
    LucideMinimize2,
    LucidePanelRight,
    LucidePanelRightClose,
    LucideX,
  } from "@lucide/svelte"
  import { appState } from "@/states.svelte"
  import Diagnostics from "@/components/diagnostics.svelte"
  import { getCurrentWindow } from "@tauri-apps/api/window"
  import { app } from "@tauri-apps/api"
  import { save } from "@tauri-apps/plugin-dialog"
  import { export_to } from "@/ipc"

  let { children } = $props()

  const window = getCurrentWindow()

  let appTitle = $state("")

  async function fetchAppTitle() {
    const name = await app.getName()
    const version = await app.getVersion()
    appTitle = `${name} v${version}`
  }
  fetchAppTitle()

  const openedFilePath = $derived(
    appState.currentFilePath
      .replace(appState.workspacePath, "")
      .replace(/^\/|\\/, "")
  )

  // TODO: add a platform check for Windows, Linux, MacOS and use the appropriate icons for (minimize, maximize, close)
</script>

<Sidebar.Provider
  style="--sidebar-width: 15rem; --sidebar-width-mobile: 20rem;"
  bind:open={appState.isFileTreeOpen}
>
  <LeftSidebar />
  <Sidebar.Inset>
    <header class="flex shrink-0 items-center justify-between gap-2 px-2">
      <img src="./icon.png" alt="App Icon" class="size-5" />
      <h1 class=" font-medium">{appTitle} {openedFilePath}</h1>
      <div class="flex">
        <Button
          size="icon"
          class="size-7"
          variant="ghost"
          onclick={() => window.minimize()}
        >
          <LucideMinimize2 />
        </Button>
        <Button
          size="icon"
          class="size-7"
          variant="ghost"
          onclick={() => window.close()}
        >
          <LucideX />
        </Button>
      </div>
    </header>
    <section class="100-svw h-100vh">
      <div class="flex gap-2">
        <Sidebar.Trigger />
        <Diagnostics />
        <Button
          size="icon"
          class="size-7"
          variant="ghost"
          onclick={() =>
            (appState.isPreviewPaneOpen = !appState.isPreviewPaneOpen)}
        >
          {#if appState.isPreviewPaneOpen}
            <LucidePanelRight />
          {:else}
            <LucidePanelRightClose />
          {/if}
        </Button>

        <Button
          size="icon"
          class="size-7"
          variant="ghost"
          onclick={async () => {
            if (!appState.currentFilePath) {
              alert("Please open a file to export.")
              return
            }
            const export_path = await save({
              defaultPath: appState.currentFilePath.replace(
                /\.[^/.]+$/,
                ".pdf"
              ),
              filters: [{ name: "PDF", extensions: ["pdf"] }],
            })

            if (export_path) {
              let res = await export_to(
                appState.currentFilePath,
                export_path,
                appState.text
              )
            }
          }}
        >
          export
        </Button>
      </div>
      {@render children?.()}
    </section>
  </Sidebar.Inset>
</Sidebar.Provider>

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
