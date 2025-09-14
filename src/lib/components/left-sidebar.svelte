<!-- Contains the file tree -->
<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar"
  import { app } from "@/states.svelte"
  import { Button } from "./ui/button"
</script>

<Sidebar.Root variant="floating" side="left">
  <Sidebar.Header>
    <Sidebar.Menu>
      {#if app.workspacePath === ""}
        <Button onclick={() => app.openWorkspace()}>open workspace</Button>
      {:else}
        <p class="font-semibold text-lg">{app.workspaceName}</p>
      {/if}
    </Sidebar.Menu>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Files</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          {#each app.entries as entry}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton onclick={() => app.openFile(entry)}>
                {entry}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
  <Sidebar.Footer />
</Sidebar.Root>
