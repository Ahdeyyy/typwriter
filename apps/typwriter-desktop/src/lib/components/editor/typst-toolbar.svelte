<script lang="ts">
  import { TextB, TextItalic, TextStrikethrough, Code, CodeBlock } from "phosphor-svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import {
    toggleBold,
    toggleItalic,
    toggleRawInline,
    toggleStrikethrough,
    toggleLineComment,
    toggleBlockComment,
  } from "$lib/typst-codemirror-lang";
  import type { EditorView } from "@codemirror/view";
  import type { Component } from "svelte";

  type Cmd = (view: EditorView) => boolean;

  const actions: { label: string; shortcut?: string; icon: Component; run: Cmd }[] = [
    { label: "Bold", shortcut: "Ctrl+B", icon: TextB, run: toggleBold },
    { label: "Italic", shortcut: "Ctrl+I", icon: TextItalic, run: toggleItalic },
    { label: "Inline code", shortcut: "Ctrl+E", icon: Code, run: toggleRawInline },
    { label: "Strikethrough", icon: TextStrikethrough, run: toggleStrikethrough },
    { label: "Toggle line comment", icon: CodeBlock, run: toggleLineComment },
    { label: "Toggle block comment", icon: CodeBlock, run: toggleBlockComment },
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
          <button
            {...props}
            type="button"
            class="tb-btn"
            onclick={() => dispatch(action.run)}
            aria-label={action.label}
          >
            <action.icon size={14} weight="regular" />
          </button>
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

  .tb-btn {
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

  .tb-btn:hover {
    background-color: color-mix(in srgb, var(--foreground) 8%, transparent);
    color: var(--foreground);
  }

  .tb-btn:active {
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
