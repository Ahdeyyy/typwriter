<script lang="ts">

  import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/svelte";
  import { TextBoldIcon, TextItalicIcon, TextStrikethroughIcon,  CodeIcon } from "@hugeicons/core-free-icons";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import {
    toggleBold,
    toggleItalic,
    toggleRawInline,
    toggleStrikethrough,
  } from "$lib/typst-codemirror-lang";
  import type { EditorView } from "@codemirror/view";

  type Cmd = (view: EditorView) => boolean;

  const actions: { label: string; shortcut?: string; icon: typeof TextBoldIcon; run: Cmd }[] = [
    { label: "Bold", shortcut: "Ctrl+B", icon: TextBoldIcon, run: toggleBold },
    { label: "Italic", shortcut: "Ctrl+I", icon: TextItalicIcon, run: toggleItalic },
    { label: "Inline code", shortcut: "Ctrl+E", icon: CodeIcon, run: toggleRawInline },
    { label: "Strikethrough", icon: TextStrikethroughIcon, run: toggleStrikethrough },
  ];

  function dispatch(run: Cmd) {
    const view = editorSearch.getActiveView();
    if (!view) return;
    run(view);
    view.focus();
  }
</script>

<div class="typst-toolbar" role="toolbar" aria-label="Typst formatting">
  {#each actions as action, i}
    {#if i === 4}
      <span class="separator" aria-hidden="true"></span>
    {/if}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon-sm"
            class="tb-btn"
            onclick={() => dispatch(action.run)}
            aria-label={action.label}
          >
            <HugeiconsIcon icon={action.icon} size={14}/>
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="bottom">
        {action.label}{#if action.shortcut}<span class="ml-2 opacity-60">{action.shortcut}</span>{/if}
      </Tooltip.Content>
    </Tooltip.Root>
  {/each}
</div>

<style>
  .typst-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    flex-shrink: 0;
    padding: 0 6px;
    background-color: var(--background);
    border-bottom: 1px solid var(--border);
  }

  :global(.tb-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: color-mix(in srgb, var(--foreground) 70%, transparent);
    cursor: pointer;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  :global(.tb-btn:hover) {
    background-color: color-mix(in srgb, var(--foreground) 8%, transparent);
    color: var(--foreground);
  }

  :global(.tb-btn:active) {
    background-color: color-mix(in srgb, var(--foreground) 14%, transparent);
  }

  .separator {
    display: inline-block;
    width: 1px;
    height: 14px;
    margin: 0 4px;
    background-color: var(--border);
  }
</style>
