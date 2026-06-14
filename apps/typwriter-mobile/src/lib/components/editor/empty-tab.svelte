<script lang="ts">
  import { toast } from "svelte-sonner";
  import {
    FolderOpenIcon,
    FileAddIcon,
    FolderLibraryIcon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Dialog from "$lib/components/ui/dialog";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";

  let createOpen = $state(false);
  let newName = $state("");

  function submitCreate() {
    let name = newName.trim();
    if (!name) return toast.error("Name cannot be empty");
    if (!/\.[^./]+$/.test(name)) name += ".typ"; // default extension
    workspace.createFile(name).match(
      () => {
        createOpen = false;
        newName = "";
        editor.loadFile(name).mapErr((e) => toast.error(`Failed to open: ${e}`));
      },
      (e) => toast.error(`Failed to create: ${e}`),
    );
  }
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 p-8">
  <p class="text-muted-foreground mb-2 text-sm">No file open</p>
  <div class="flex w-full max-w-xs flex-col gap-2">
    <Button variant="secondary" class="w-full justify-start" onclick={() => app.openOverlay("quickswitcher")}>
      <Icon icon={FolderOpenIcon} /> Open file
    </Button>
    <Button variant="secondary" class="w-full justify-start" onclick={() => (createOpen = true)}>
      <Icon icon={FileAddIcon} /> Create new file
    </Button>
    <Button variant="secondary" class="w-full justify-start" onclick={() => workspace.close()}>
      <Icon icon={FolderLibraryIcon} /> Switch workspace
    </Button>
  </div>
</div>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Create new file</Dialog.Title>
      <Dialog.Description>Created at the workspace root. Defaults to <code>.typ</code>.</Dialog.Description>
    </Dialog.Header>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submitCreate();
      }}
    >
      <Input bind:value={newName} placeholder="untitled.typ" autocapitalize="off" autocorrect="off" spellcheck={false} />
      <Dialog.Footer class="mt-4">
        <Button type="submit" class="w-full">Create</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
