<script lang="ts">
  import * as Sidebar from "@/components/ui/sidebar"
  import * as DropdownMenu from "@/components/ui/dropdown-menu"
  import { ChevronDown } from "@lucide/svelte"
  import { appState } from "@/states.svelte"

  let dropdownOpen = $state(false)
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root bind:open={dropdownOpen}>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton {...props}>
            {appState.workspaceName || "Select Workspace"}
            <ChevronDown class="ml-auto" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
        <DropdownMenu.Item>
          {#snippet child({ props })}
            <Sidebar.MenuButton
              {...props}
              onclick={async () => {
                let result = await appState.openWorkspace()
                // close the dropdown if a workspace was selected
                if (result) {
                  dropdownOpen = false
                }
              }}
            >
              Open Workspace
            </Sidebar.MenuButton>
          {/snippet}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
