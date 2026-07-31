<script lang="ts">
  import SettingGroup from "../setting-group.svelte";

  type Binding = { keys: string; description: string };
  type Section = { title: string; bindings: Binding[] };

  const sections: Section[] = [
    {
      title: "Global",
      bindings: [{ keys: "Ctrl+Shift+B", description: "Toggle the sidebar" }],
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
</script>

<SettingGroup title="Keymaps" description="Keyboard shortcuts available throughout Typwriter.">
  <div class="flex flex-col gap-6">
    {#each sections as section (section.title)}
      <div>
        <h3 class="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section.title}
        </h3>
        <div class="overflow-hidden rounded-md border border-border">
          <!-- Keyed on `keys`, not `description` — several preview bindings
               share a description (← / PageUp both say "Previous page"), and a
               duplicate key aborts the whole render. -->
          {#each section.bindings as binding (binding.keys)}
            <div
              class="flex items-center justify-between gap-4 px-4 py-2.5 not-first:border-t not-first:border-border"
            >
              <span class="text-sm">{binding.description}</span>
              <span class="flex shrink-0 items-center gap-1">
                <!-- Unkeyed: a chord can legitimately repeat a token. -->
                {#each binding.keys.split("+") as key, k}
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
      </div>
    {/each}
  </div>
</SettingGroup>
