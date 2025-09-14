<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar/index.js"
  import LeftSidebar from "@/components/left-sidebar.svelte"
  import "../app.css"
  import Button from "@/components/ui/button/button.svelte"
  import { Badge } from "@/components/ui/badge"
  import {
    LucidePanelBottom,
    LucidePanelLeft,
    LucidePanelRight,
  } from "@lucide/svelte"
  import { app } from "@/states.svelte"
  import Diagnostics from "@/components/diagnostics.svelte"

  let { children } = $props()
</script>

<Sidebar.Provider
  style="--sidebar-width: 15rem; --sidebar-width-mobile: 20rem;"
  bind:open={app.isFileTreeOpen}
>
  <LeftSidebar />
  <Sidebar.Inset>
    <main class="100-svw h-95vh">
      <nav class="flex items-center gap-1">
        <Sidebar.Trigger />
        <Diagnostics />
        <Button
          size="icon"
          class="size-7"
          variant="ghost"
          onclick={() => (app.isPreviewPaneOpen = !app.isPreviewPaneOpen)}
        >
          <LucidePanelRight />
        </Button>
      </nav>

      {@render children?.()}
    </main>
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
