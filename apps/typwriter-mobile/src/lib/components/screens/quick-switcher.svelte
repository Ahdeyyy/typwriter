<script lang="ts">
  import { toast } from "svelte-sonner";
  import {
    Search01Icon,
    File02Icon,
    Image01Icon,
    File01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { Input } from "$lib/components/ui/input";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { flattenFiles, searchFiles } from "$lib/editor/file-search";

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  const open = $derived(app.overlay === "quickswitcher");
  const entries = $derived(flattenFiles(workspace.tree));
  const results = $derived(searchFiles(entries, query).slice(0, 60));

  // Reset + focus whenever the switcher opens.
  $effect(() => {
    if (open) {
      query = "";
      queueMicrotask(() => inputEl?.focus());
    }
  });

  function iconFor(name: string): IconSvgElement {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return Image01Icon;
    if (name.endsWith(".typ")) return File02Icon;
    return File01Icon;
  }

  function pick(relPath: string) {
    app.closeOverlay();
    editor.loadFile(relPath).mapErr((e) => toast.error(`Failed to open: ${e}`));
  }
</script>

{#if open}
  <div
    class="bg-background/70 fixed inset-0 z-50 flex flex-col backdrop-blur-sm"
    style="padding-top: env(safe-area-inset-top);"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) app.closeOverlay();
    }}
  >
    <div class="bg-popover text-popover-foreground mx-3 mt-3 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border shadow-xl">
      <div class="flex items-center gap-2 border-b px-3">
        <Icon icon={Search01Icon} class="text-muted-foreground size-4 shrink-0" />
        <Input
          bind:ref={inputEl}
          bind:value={query}
          placeholder="Search files…"
          class="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
        />
      </div>
      <div class="flex-1 overflow-y-auto overscroll-contain p-1.5">
        {#if results.length === 0}
          <p class="text-muted-foreground p-6 text-center text-sm">No matching files.</p>
        {:else}
          {#each results as entry (entry.relPath)}
            <button
              class="active:bg-accent active:text-accent-foreground flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
              onclick={() => pick(entry.relPath)}
            >
              <Icon icon={iconFor(entry.name)} class="text-muted-foreground size-4 shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm">{entry.name}</span>
                {#if entry.relPath !== entry.name}
                  <span class="text-muted-foreground block truncate text-xs">{entry.relPath}</span>
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
