<!-- Contains the file tree -->
<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { appState } from "@/states.svelte";
  import { Button } from "./ui/button";
  import WorkspaceSwitcher from "./workspace-switcher.svelte";
  import { ChevronRightIcon, FileIcon, FolderIcon } from "@lucide/svelte";
  import * as Collapsible from "./ui/collapsible";
  import { getFileName } from "@/utils";
</script>

<Sidebar.Root variant="sidebar" side="left">
  <Sidebar.Header>
    <WorkspaceSwitcher />
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          {#each appState.entries as item, index (index)}
            {@render Tree({ item })}
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
  <Sidebar.Footer />
</Sidebar.Root>

<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
{#snippet Tree({ item }: { item: string | any[] })}
  {@const [name, ...items] = Array.isArray(item) ? item : [item]}
  {#if items.length == 0}
    {#if name}
      <Sidebar.MenuButton
        isActive={name === getFileName(appState.currentFilePath)}
        class="data-[active=true]:bg-primary/30"
        onclick={() => {
          if (name !== getFileName(appState.currentFilePath)) {
            appState.openFile(name);
          }
        }}
      >
        <FileIcon />
        {getFileName(name)}
      </Sidebar.MenuButton>
    {/if}
  {:else}
    <Sidebar.MenuItem>
      <Collapsible.Root
        class="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        open={name === "lib" || name === "components"}
      >
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Sidebar.MenuButton {...props}>
              <ChevronRightIcon className="transition-transform" />
              <FolderIcon />
              {name}
            </Sidebar.MenuButton>
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Sidebar.MenuSub>
            {#each items as subItem, index (index)}
              {@render Tree({ item: subItem })}
            {/each}
          </Sidebar.MenuSub>
        </Collapsible.Content>
      </Collapsible.Root>
    </Sidebar.MenuItem>
  {/if}
{/snippet}
