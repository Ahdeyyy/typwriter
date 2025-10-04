<script lang="ts">
  import * as DropdownMenu from "@/components/ui/dropdown-menu"
  import Button from "@/components/ui/button/button.svelte"
  import { ChevronDown, Check } from "@lucide/svelte"
  import { appState } from "@/states.svelte"

  let dropdownOpen = $state(false)

  async function handleSelectRecent(path: string) {
    await appState.openRecentWorkspace(path)
    dropdownOpen = false
  }

  async function handleOpenWorkspace() {
    const opened = await appState.openWorkspace()
    if (opened) dropdownOpen = false
  }
</script>

<div class="workspace-switcher">
  <DropdownMenu.Root bind:open={dropdownOpen}>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          class="w-full flex items-center justify-between px-3 py-2 text-sm"
        >
          <span class="truncate"
            >{appState.workspaceName || "Select Workspace"}</span
          >
          <ChevronDown class="ml-2" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>

    <DropdownMenu.Content class="w-(--bits-dropdown-menu-anchor-width)">
      {#if appState.recentWorkspaces.length > 0}
        {#each appState.recentWorkspaces as w}
          <DropdownMenu.Item>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                class="w-full flex items-center justify-between px-2 py-1.5 text-sm"
                onclick={() => handleSelectRecent(w.path)}
              >
                <span class="truncate">{w.name}</span>
                {#if appState.workspacePath === w.path}
                  <Check class="size-4" />
                {/if}
              </Button>
            {/snippet}
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator />
      {/if}
      <DropdownMenu.Item>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            class="w-full justify-start px-2 py-1.5 text-sm"
            onclick={handleOpenWorkspace}
          >
            Open Workspace
          </Button>
        {/snippet}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
