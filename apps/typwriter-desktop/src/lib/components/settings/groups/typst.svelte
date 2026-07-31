<script lang="ts">
  import { onMount } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Folder01Icon,
    FolderAddIcon,
    Delete01Icon,
    RefreshIcon,
    BookOpen01Icon,
    LinkSquare02Icon,
  } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { getTypstVersion } from "$lib/ipc/commands";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";

  // Reported by the compiler itself, so it can't drift from what actually
  // renders your documents.
  let typstVersion = $state<string | null>(null);

  onMount(() => {
    getTypstVersion().match(
      (version) => {
        typstVersion = version;
      },
      (err) => logError("get_typst_version failed:", err),
    );
  });

  async function handleAddFontDir() {
    const selected = await openDialog({ directory: true, multiple: false });
    const folder = (selected as string | null) ?? null;
    if (!folder) return;
    const result = await settings.addFontDirectory(folder);
    result.match(
      () => toast.success("Font directory added — reloading fonts…"),
      (err) => toast.error(`Failed to add font directory: ${err}`),
    );
  }

  async function handleRemoveFontDir(dir: string) {
    const result = await settings.removeFontDirectory(dir);
    result.match(
      () => toast.success("Font directory removed — reloading fonts…"),
      (err) => toast.error(`Failed to remove font directory: ${err}`),
    );
  }
</script>

<SettingGroup
  title="Typst"
  description="Settings for the Typst compiler itself. Font directories are scanned for additional font files (.ttf, .otf); fonts found there are available in the editor, the font pickers, and in Typst documents."
>
  {#snippet aside()}
    {#if settings.fontsReloading}
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HugeiconsIcon icon={RefreshIcon} class="size-3 animate-spin" />
        Reloading fonts…
      </span>
    {/if}
  {/snippet}

  <SettingRow
    title="Compiler version"
    description="The Typst release bundled with this build of Typwriter. Documents see the same value as sys.version."
  >
    {#snippet control()}
      <span class="text-sm tabular-nums text-muted-foreground">
        {typstVersion ? `v${typstVersion}` : "Loading…"}
      </span>
    {/snippet}
  </SettingRow>

  <h3 class="mb-2 mt-6 text-sm font-medium">Font directories</h3>

  <div class="rounded-md border border-border">
    {#if settings.fontDirectories.length === 0}
      <p class="px-4 py-6 text-center text-sm text-muted-foreground">
        No extra font directories. Only system + bundled fonts are loaded.
      </p>
    {:else}
      <ul>
        {#each settings.fontDirectories as dir, i (dir)}
          <li
            class="flex items-center gap-3 px-4 py-2.5 {i > 0 ? 'border-t border-border' : ''}"
          >
            <HugeiconsIcon icon={Folder01Icon} class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm">{dir}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onclick={() => handleRemoveFontDir(dir)}
              aria-label="Remove font directory"
              disabled={settings.fontsReloading}
            >
              <HugeiconsIcon icon={Delete01Icon} class="size-4 text-destructive" />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="mt-3 flex justify-end">
    <Button
      variant="outline"
      size="sm"
      class="gap-2"
      onclick={handleAddFontDir}
      disabled={settings.fontsReloading}
    >
      <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
      Add font directory
    </Button>
  </div>

  <h3 class="mb-2 mt-6 text-sm font-medium">Reference</h3>

  <SettingRow
    title="Typst documentation"
    description="The official language and library reference, opened in your browser."
  >
    {#snippet control()}
      <Button
        variant="outline"
        size="sm"
        class="gap-2 shrink-0"
        onclick={() =>
          openUrl("https://typst.app/docs/").catch((err) =>
            logError("open Typst docs failed:", err),
          )}
      >
        <HugeiconsIcon icon={BookOpen01Icon} class="size-4" />
        Open docs
        <HugeiconsIcon icon={LinkSquare02Icon} class="size-3.5 text-muted-foreground" />
      </Button>
    {/snippet}
  </SettingRow>
</SettingGroup>
