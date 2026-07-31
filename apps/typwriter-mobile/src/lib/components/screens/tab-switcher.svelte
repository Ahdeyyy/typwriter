<script lang="ts">
  import { toast } from "svelte-sonner";
  import {
    Add01Icon,
    Cancel01Icon,
    File02Icon,
    Image01Icon,
    File01Icon,
  } from "@hugeicons/core-free-icons";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$lib/components/icon.svelte";
  import { app } from "$lib/stores/app.svelte";
  import { editor } from "$lib/stores/editor.svelte";

  const open = $derived(app.overlay === "tabswitcher");
  const count = $derived(editor.tabs.length + (editor.newTabOpen ? 1 : 0));

  function basename(rel: string): string {
    const parts = rel.split("/");
    return parts[parts.length - 1] ?? rel;
  }

  function iconFor(name: string): IconSvgElement {
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) return Image01Icon;
    if (name.endsWith(".typ")) return File02Icon;
    return File01Icon;
  }

  function pick(rel: string) {
    app.closeOverlay();
    if (!editor.isActiveTab(rel)) {
      editor.loadFile(rel).mapErr((e) => toast.error(`Failed to open: ${e}`));
    }
  }

  function newTab() {
    editor.openNewTab();
    app.closeOverlay();
  }
</script>

{#if open}
  <div
    class="bg-background fixed inset-0 z-50 flex flex-col"
    style="padding-top: env(safe-area-inset-top);"
  >
    <!-- Tab grid -->
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      <div class="grid grid-cols-2 gap-4">
        {#each editor.tabs as rel (rel)}
          {@const active = editor.isActiveTab(rel)}
          <div class="flex flex-col gap-1.5">
            <div class="relative">
              <button
                class="bg-card flex aspect-[3/4] w-full items-center justify-center rounded-xl border transition-shadow {active
                  ? 'ring-primary border-primary/60 ring-2'
                  : 'border-border'}"
                onclick={() => pick(rel)}
              >
                <Icon icon={iconFor(rel)} class="text-muted-foreground size-10" />
              </button>
              <button
                class="bg-background/80 hover:text-foreground text-muted-foreground absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full"
                aria-label="Close tab"
                onclick={() => editor.closeTab(rel)}
              >
                <Icon icon={Cancel01Icon} class="size-4" />
              </button>
            </div>
            <span class="truncate px-1 text-center text-sm {active ? 'text-foreground font-medium' : 'text-muted-foreground'}">
              {basename(rel)}
            </span>
          </div>
        {/each}

        {#if editor.newTabOpen}
          <div class="flex flex-col gap-1.5">
            <button
              class="bg-card ring-primary border-primary/60 flex aspect-[3/4] w-full items-center justify-center rounded-xl border ring-2"
              onclick={() => app.closeOverlay()}
            >
              <Icon icon={File01Icon} class="text-muted-foreground size-10" />
            </button>
            <span class="text-foreground truncate px-1 text-center text-sm font-medium">New tab</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Bottom bar: new tab · count · done -->
    <div
      class="flex shrink-0 items-center border-t px-4 py-3"
      style="padding-bottom: calc(env(safe-area-inset-bottom) + 0.75rem);"
    >
      <button
        class="hover:text-foreground text-foreground flex size-9 items-center justify-center"
        aria-label="New tab"
        onclick={newTab}
      >
        <Icon icon={Add01Icon} class="size-6" />
      </button>
      <span class="text-foreground flex-1 text-center text-sm font-medium">
        {count} tab{count === 1 ? "" : "s"}
      </span>
      <button class="text-foreground px-1 text-sm font-medium" onclick={() => app.closeOverlay()}>
        Done
      </button>
    </div>
  </div>
{/if}
