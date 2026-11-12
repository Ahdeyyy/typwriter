<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Cancel01Icon, Add01Icon, File01Icon, File02Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { basename, parentDir } from "$lib/paths";
  import { screen } from "$lib/motion";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { flattenFiles, searchFiles } from "$lib/editor/file-search";

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  const open = $derived(app.overlay === "quickswitcher");
  const entries = $derived(flattenFiles(workspace.tree));
  const results = $derived(searchFiles(entries, query).slice(0, 60));

  // Show a "create" affordance when the query names a note that doesn't exist.
  const trimmed = $derived(query.trim());
  const canCreate = $derived(
    trimmed.length > 0 &&
      !results.some(
        (r) => displayName(r.relPath).toLowerCase() === trimmed.toLowerCase(),
      ),
  );

  // Reset + focus whenever the switcher opens.
  $effect(() => {
    if (open) {
      query = "";
      queueMicrotask(() => inputEl?.focus());
    }
  });

  /** Strip the `.typ` extension for display, like Obsidian hides `.md`. */
  function displayName(relPath: string): string {
    return relPath.replace(/\.typ$/i, "");
  }

  function pick(relPath: string) {
    app.closeOverlay();
    editor.loadFile(relPath).mapErr((e) => toast.error(`Failed to open: ${e}`));
  }

  function create() {
    if (!trimmed) return;
    // Treat the query as a path; default to a `.typ` note when no extension.
    const rel = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.typ`;
    app.closeOverlay();
    workspace
      .createFile(rel)
      .andThen(() => editor.loadFile(rel))
      .mapErr((e) => toast.error(`Failed to create: ${e}`));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      app.closeOverlay();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) pick(results[0].relPath);
      else if (canCreate) create();
    }
  }
</script>

{#if open}
  <div
    transition:screen={{ duration: 200, scale: 0.98 }}
    class="bg-background fixed inset-x-0 top-0 z-50 flex flex-col overflow-hidden"
    style="height: var(--app-height, 100svh); padding-top: calc(var(--app-inset-top, 0px) + env(safe-area-inset-top));"
    role="presentation"
  >
    <!-- Results — list on top, most relevant nearest the input below. -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 tablet:px-[max(0.5rem,calc(50%-21rem))]">
      {#if results.length === 0 && !canCreate}
        <p class="text-muted-foreground p-8 text-center text-sm">No matching notes.</p>
      {:else}
        {#each results as entry, i (entry.relPath)}
          {@const dir = parentDir(entry.relPath)}
          <!-- The top hit (what Enter opens) gets a neutral state layer, not
               an inverted fill: it is a hint, not a selection. -->
          <button
            class="text-foreground flex min-h-14 w-full items-center gap-3.5 rounded-2xl px-4 py-2 text-left {i === 0
              ? 'bg-foreground/[0.07]'
              : ''}"
            onclick={() => pick(entry.relPath)}
          >
            <Icon
              icon={entry.relPath.endsWith(".typ") ? File02Icon : File01Icon}
              class="text-muted-foreground size-6 shrink-0"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[15px] {i === 0 ? 'font-medium' : ''}">
                {displayName(basename(entry.relPath))}
              </span>
              {#if dir !== "/"}
                <span class="text-muted-foreground block truncate text-xs">{dir}</span>
              {/if}
            </span>
          </button>
        {/each}

        {#if canCreate}
          <button
            class="text-muted-foreground flex min-h-14 w-full items-center gap-3.5 rounded-2xl px-4 py-2.5 text-left text-[15px]"
            onclick={create}
          >
            <Icon icon={Add01Icon} class="size-6 shrink-0" />
            <span class="min-w-0 flex-1 truncate">Create <span class="text-foreground">{trimmed}</span></span>
          </button>
        {/if}
      {/if}
    </div>

    <!-- Search input, pinned to the bottom above the keyboard. -->
    <div
      class="shrink-0 px-3 pt-2 tablet:px-[max(0.75rem,calc(50%-21rem))]"
      style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem);"
    >
      <div class="bg-muted flex items-center gap-2 rounded-full py-1 pl-5 pr-2">
        <input
          bind:this={inputEl}
          bind:value={query}
          onkeydown={onKeydown}
          placeholder="Find or create a note…"
          class="text-foreground placeholder:text-muted-foreground h-10 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint="go"
        />
        <button
          class="text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
          aria-label={query ? "Clear" : "Close"}
          onclick={() => (query ? (query = "") : app.closeOverlay())}
        >
          <Icon icon={Cancel01Icon} class="size-6" />
        </button>
      </div>
    </div>
  </div>
{/if}
