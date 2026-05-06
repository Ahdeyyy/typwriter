<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import { page } from "$lib/stores/page.svelte";

  type Binding = { keys: string; description: string };
  type Group = { title: string; bindings: Binding[] };

  const groups: Group[] = [
    {
      title: "Global",
      bindings: [
        { keys: "Ctrl+Shift+B", description: "Toggle the sidebar" },
      ],
    },
    {
      title: "Editor",
      bindings: [
        { keys: "Ctrl+S", description: "Save current file" },
        { keys: "Shift+Alt+F", description: "Format current .typ file" },
        { keys: "Ctrl+F", description: "Open find panel" },
        { keys: "Ctrl+H", description: "Open find & replace panel" },
        { keys: "Esc", description: "Close search panel" },
        { keys: "Tab", description: "Indent selection" },
        { keys: "Ctrl+Z", description: "Undo" },
        { keys: "Ctrl+Y", description: "Redo" },
      ],
    },
    {
      title: "Typst Formatting (.typ files)",
      bindings: [
        { keys: "Ctrl+B", description: "Toggle bold" },
        { keys: "Ctrl+I", description: "Toggle italic" },
        { keys: "Ctrl+E", description: "Toggle inline code" },
      ],
    },
    {
      title: "Search Panel",
      bindings: [
        { keys: "Enter", description: "Find next match" },
        { keys: "Shift+Enter", description: "Find previous match" },
        { keys: "Ctrl+Enter", description: "Replace all" },
      ],
    },
    {
      title: "Preview",
      bindings: [
        { keys: "Esc", description: "Exit presentation mode" },
        { keys: "←", description: "Previous page (paginated/presentation)" },
        { keys: "→", description: "Next page (paginated/presentation)" },
        { keys: "PageUp", description: "Previous page (paginated/presentation)" },
        { keys: "PageDown", description: "Next page (paginated/presentation)" },
        { keys: "Space", description: "Next page (paginated/presentation)" },
        { keys: "Home", description: "Jump to first page" },
        { keys: "End", description: "Jump to last page" },
      ],
    },
  ];

  function renderKey(keys: string) {
    return keys.split("+");
  }
</script>

<div class="relative flex h-screen w-screen flex-col overflow-hidden">
  <Titlebar variant="minimal" title="Keymaps" />

  <div class="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
    <Button variant="ghost" size="sm" class="gap-2" onclick={() => page.back("home")}>
      <HugeiconsIcon icon={ArrowLeft01Icon} class="size-4" />
      Back
    </Button>
    <h1 class="text-base font-semibold">Keyboard Shortcuts</h1>
  </div>

  <div class="min-h-0 flex-1">
    <ScrollArea.Root class="h-full">
      <div class="mx-auto w-full max-w-3xl px-6 py-6">
        {#each groups as group}
          <section class="mb-8">
            <h2 class="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div class="overflow-hidden rounded-md border border-border">
              {#each group.bindings as binding, i}
                <div
                  class="flex items-center justify-between gap-4 px-4 py-2.5 {i > 0 ? 'border-t border-border' : ''}"
                >
                  <span class="text-sm">{binding.description}</span>
                  <span class="flex items-center gap-1">
                    {#each renderKey(binding.keys) as key, k}
                      {#if k > 0}
                        <span class="text-xs text-muted-foreground">+</span>
                      {/if}
                      <kbd
                        class="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-foreground"
                      >
                        {key}
                      </kbd>
                    {/each}
                  </span>
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </ScrollArea.Root>
  </div>
</div>
