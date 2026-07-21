<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Cancel01Icon, Add01Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
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
    class="bg-background fixed z-50 flex flex-col overflow-hidden"
    style="top: var(--vv-top, 0px); left: var(--vv-left, 0px); width: var(--vv-width, 100vw); height: var(--app-height, 100svh); padding-top: env(safe-area-inset-top);"
    role="presentation"
  >
    <!-- Results — list on top, most relevant nearest the input below. -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
      {#if results.length === 0 && !canCreate}
        <p class="text-muted-foreground p-8 text-center text-sm">No matching notes.</p>
      {:else}
        {#each results as entry, i (entry.relPath)}
          <button
            class="flex w-full items-center rounded-xl px-4 py-3 text-left text-[15px] {i === 0
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground'}"
            onclick={() => pick(entry.relPath)}
          >
            <span class="min-w-0 flex-1 truncate">{displayName(entry.relPath)}</span>
          </button>
        {/each}

        {#if canCreate}
          <button
            class="text-muted-foreground flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left text-[15px]"
            onclick={create}
          >
            <Icon icon={Add01Icon} class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">Create <span class="text-foreground">{trimmed}</span></span>
          </button>
        {/if}
      {/if}
    </div>

    <!-- Search input, pinned to the bottom above the keyboard. -->
    <div
      class="shrink-0 px-3 pt-2"
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
          class="text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
          aria-label={query ? "Clear" : "Close"}
          onclick={() => (query ? (query = "") : app.closeOverlay())}
        >
          <Icon icon={Cancel01Icon} class="size-5" />
        </button>
      </div>
    </div>
  </div>
{/if}
