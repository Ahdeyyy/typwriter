<script lang="ts">
  import * as Sidebar from "@/components/ui/sidebar"
  import * as DropdownMenu from "@/components/ui/dropdown-menu"
  import { ChevronDown } from "@lucide/svelte"
  import { app } from "@/states.svelte"
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton {...props}>
            {app.workspaceName || "Select Workspace"}
            <ChevronDown class="ml-auto" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
        <DropdownMenu.Item>
          {#snippet child({ props })}
            <Sidebar.MenuButton {...props} onclick={() => app.openWorkspace()}>
              Open Workspace
            </Sidebar.MenuButton>
          {/snippet}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
