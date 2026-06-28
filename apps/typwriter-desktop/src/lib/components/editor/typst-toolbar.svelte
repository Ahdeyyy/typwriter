<script lang="ts">
  import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/svelte";
  import {
    TextBoldIcon,
    TextItalicIcon,
    TextStrikethroughIcon,
    CodeIcon,
    Heading01Icon,
    ArrowDown01Icon,
    LeftToRightListBulletIcon,
    LeftToRightListNumberIcon,
    SourceCodeSquareIcon,
    Link01Icon,
    Image01Icon,
    Table01Icon,
  } from "@hugeicons/core-free-icons";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { editorFormat } from "$lib/stores/editor-format.svelte";
  import {
    toggleBold,
    toggleItalic,
    toggleRawInline,
    toggleStrikethrough,
    setHeadingLevel,
    toggleBulletList,
    toggleNumberedList,
    insertCodeBlock,
    insertImage,
    insertLink,
    insertTable,
  } from "$lib/typst-codemirror-lang";
  import type { EditorView } from "@codemirror/view";

  type Cmd = (view: EditorView) => boolean;

  type Action = {
    label: string;
    shortcut?: string;
    icon: IconSvgElement;
    run: Cmd;
    active?: () => boolean;
  };

  function dispatch(run: Cmd) {
    const view = editorSearch.getActiveView();
    if (!view) return;
    run(view);
    editorFormat.refresh(view);
    view.focus();
  }

  const HEADING_LABELS = [
    "Normal text",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Heading 4",
    "Heading 5",
    "Heading 6",
  ];
  const headingLabel = $derived(
    HEADING_LABELS[editorFormat.headingLevel] ?? "Normal text",
  );

  const marks: Action[] = [
    { label: "Bold", shortcut: "Ctrl+B", icon: TextBoldIcon, run: toggleBold, active: () => editorFormat.bold },
    { label: "Italic", shortcut: "Ctrl+I", icon: TextItalicIcon, run: toggleItalic, active: () => editorFormat.italic },
    { label: "Inline code", shortcut: "Ctrl+E", icon: CodeIcon, run: toggleRawInline, active: () => editorFormat.rawInline },
    { label: "Strikethrough", icon: TextStrikethroughIcon, run: toggleStrikethrough },
  ];

  const lists: Action[] = [
    { label: "Bulleted list", icon: LeftToRightListBulletIcon, run: toggleBulletList, active: () => editorFormat.bulletList },
    { label: "Numbered list", icon: LeftToRightListNumberIcon, run: toggleNumberedList, active: () => editorFormat.numberedList },
  ];

  const inserts: Action[] = [
    { label: "Code block", icon: SourceCodeSquareIcon, run: insertCodeBlock },
    { label: "Link", icon: Link01Icon, run: insertLink },
    { label: "Image", icon: Image01Icon, run: insertImage },
    { label: "Table", icon: Table01Icon, run: insertTable },
  ];
</script>

{#snippet toolButton(action: Action)}
  {@const isActive = action.active?.() ?? false}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          class={isActive ? "tb-btn tb-btn-active" : "tb-btn"}
          onclick={() => dispatch(action.run)}
          aria-label={action.label}
          aria-pressed={action.active ? isActive : undefined}
        >
          <HugeiconsIcon icon={action.icon} size={18} />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">
      {action.label}{#if action.shortcut}<span class="ml-2 opacity-60"
          >{action.shortcut}</span
        >{/if}
    </Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<div class="typst-toolbar" role="toolbar" aria-label="Typst formatting">
  <!-- Paragraph / heading style -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="sm"
          class="tb-heading"
          aria-label="Paragraph style"
        >
          <HugeiconsIcon icon={Heading01Icon} size={18} />
          <span class="tb-heading-label">{headingLabel}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="tb-heading-menu">
      {#each HEADING_LABELS as label, level}
        <DropdownMenu.Item
          onSelect={() => dispatch(setHeadingLevel(level))}
          class={editorFormat.headingLevel === level ? "tb-heading-item-active" : ""}
        >
          <span class={`tb-h-preview tb-h-${level}`}>{label}</span>
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <span class="separator" aria-hidden="true"></span>

  {#each marks as action}
    {@render toolButton(action)}
  {/each}

  <span class="separator" aria-hidden="true"></span>

  {#each lists as action}
    {@render toolButton(action)}
  {/each}

  <span class="separator" aria-hidden="true"></span>

  {#each inserts as action}
    {@render toolButton(action)}
  {/each}
</div>

<style>
  .typst-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    flex-shrink: 0;
    padding: 0 8px;
    background-color: var(--background);
    border-bottom: 1px solid var(--border);
  }

  :global(.tb-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: color-mix(in srgb, var(--foreground) 70%, transparent);
    cursor: pointer;
    transition:
      background-color 0.1s ease,
      color 0.1s ease;
  }

  :global(.tb-btn:hover) {
    background-color: color-mix(in srgb, var(--foreground) 8%, transparent);
    color: var(--foreground);
  }

  :global(.tb-btn:active) {
    background-color: color-mix(in srgb, var(--foreground) 14%, transparent);
  }

  /* Active (toggled-on) state — Google-Docs style highlight. */
  :global(.tb-btn-active),
  :global(.tb-btn-active:active) {
    background-color: color-mix(in srgb, var(--primary) 18%, transparent);
    color: var(--primary);
  }

  :global(.tb-btn-active:hover) {
    background-color: color-mix(in srgb, var(--primary) 26%, transparent);
    color: var(--primary);
  }

  /* Heading dropdown trigger */
  :global(.tb-heading) {
    height: 28px;
    padding: 0 8px;
    gap: 4px;
    border-radius: 4px;
    color: color-mix(in srgb, var(--foreground) 78%, transparent);
  }

  .tb-heading-label {
    font-size: 12px;
    min-width: 64px;
    text-align: left;
  }

  /* Heading preview labels in the menu scale with their level. */
  .tb-h-preview {
    line-height: 1.2;
  }
  .tb-h-0 {
    font-weight: 400;
  }
  .tb-h-1 {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .tb-h-2 {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .tb-h-3 {
    font-size: 1rem;
    font-weight: 600;
  }
  .tb-h-4 {
    font-size: 0.95rem;
    font-weight: 600;
  }
  .tb-h-5 {
    font-size: 0.9rem;
    font-weight: 600;
  }
  .tb-h-6 {
    font-size: 0.85rem;
    font-weight: 600;
  }

  :global(.tb-heading-item-active) {
    background-color: color-mix(in srgb, var(--primary) 12%, transparent);
  }

  .separator {
    display: inline-block;
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background-color: var(--border);
  }
</style>
