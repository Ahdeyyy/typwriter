<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button/index.js';
  import { workspace } from '$lib/stores/workspace.svelte';
  import { basename, dirname } from '$lib/paths';
  import { chooseDocument, openDocumentPath } from '$lib/services/document-opening';

  async function chooseRoot() {
    const path = workspace.documentPath;
    if (!path) return;
    try {
      const root = await open({
        title: 'Choose compilation root', directory: true, multiple: false,
        defaultPath: workspace.rootPath ?? undefined,
      });
      if (typeof root === 'string') await openDocumentPath(path, root);
    } catch (error) {
      toast.error(`Could not choose compilation root: ${String(error)}`);
    }
  }

  async function openFolder() {
    const path = workspace.documentPath;
    if (!path) return;
    const result = await workspace.init(dirname(path));
    if (result.isErr()) {
      toast.error(`Could not open containing folder: ${result.error}`);
      return;
    }
    const relativePath = workspace.toRel(path);
    const opened = await workspace.openFile(relativePath);
    if (opened.isErr()) {
      toast.error(`Could not open document in workspace: ${opened.error}`);
      return;
    }
    const main = await workspace.setMainFileAction(relativePath);
    if (main.isErr()) toast.error(`Could not preview document in workspace: ${main.error}`);
  }
</script>

<div class="flex flex-col gap-4 p-3">
  <div>
    <h2 class="mb-2 text-xs font-medium text-muted-foreground">Document</h2>
    <Button variant="secondary" class="w-full justify-start truncate" disabled={workspace.opening}
      title={workspace.documentPath ?? ''}
      onclick={() => workspace.mainFile && workspace.openFile(workspace.mainFile).mapErr((error) => toast.error(error))}>
      {workspace.documentPath ? basename(workspace.documentPath) : 'Typst document'}
    </Button>
  </div>
  <div class="flex flex-col gap-2">
    <h2 class="text-xs font-medium text-muted-foreground">Compilation root</h2>
    <p class="break-all text-xs text-muted-foreground">{workspace.rootPath}</p>
    <p class="text-xs text-muted-foreground">Imports and assets resolve within this folder.</p>
    <Button variant="outline" size="sm" disabled={workspace.opening} onclick={() => void chooseRoot()}>
      Choose Root
    </Button>
  </div>
  {#if workspace.tree.some((file) => file.path !== workspace.mainFile)}
    <div>
      <h2 class="mb-2 text-xs font-medium text-muted-foreground">Dependencies</h2>
      <ul class="flex flex-col gap-1">
        {#each workspace.tree.filter((file) => file.path !== workspace.mainFile) as file (file.path)}
          <li>
            <button class="w-full cursor-pointer truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
              title={file.path} disabled={workspace.opening}
              onclick={() => workspace.openFile(file.path).mapErr((error) => toast.error(error))}>
              {file.path}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <div class="flex flex-col gap-2 border-t border-sidebar-border pt-3">
    <Button variant="outline" size="sm" disabled={workspace.opening} onclick={() => void chooseDocument()}>
      Open File
    </Button>
    <Button variant="ghost" size="sm" class="h-auto whitespace-normal text-center"
      disabled={workspace.opening} onclick={() => void openFolder()}>
      Open containing folder as workspace
    </Button>
  </div>
</div>
