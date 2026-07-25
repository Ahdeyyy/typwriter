<script lang="ts">
  // One block. Inactive blocks show their **real** compiled output (crops of
  // the rendered pages); tapping one flips it into the shared source editor.
  //
  // Fallbacks, in order: a block edited since the last compile shows its
  // source (its render is out of date), and a block that rendered nothing —
  // a `#set` rule, a `#let`, a comment — shows a monospace code chip, which is
  // what it would look like anyway.

  import { MoreVerticalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { longpress } from "$lib/actions/longpress";
  import type { Block } from "$lib/blocks/segment";
  import { blocks } from "$lib/stores/blocks.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import BlockEditor from "./block-editor.svelte";
  import BlockFragment from "./block-fragment.svelte";
  import BlockMenu from "./block-menu.svelte";

  let { block, width }: { block: Block; width: number } = $props();

  let menuOpen = $state(false);

  const active = $derived(blocks.activeId === block.id);
  const source = $derived(blocks.textOf(block));
  const extents = $derived(blocks.extentsOf(block));
  const stale = $derived(blocks.isStale(block));
  /** A crop of the real render is only truthful while the block is unedited. */
  const showFragment = $derived(!stale && extents.length > 0);
  /** Source-looking kinds keep their monospace chip even when they render. */
  const chip = $derived(!showFragment && (block.kind === "script" || block.kind === "raw"));

  const startLine = $derived(blocks.doc.slice(0, block.from).split("\n").length - 1);
  const endLine = $derived(startLine + source.split("\n").length - 1);
  const severity = $derived.by(() => {
    const hit = [...compileStore.errors, ...compileStore.warnings].find(
      (d) =>
        d.filePath === editor.relPath &&
        d.range !== null &&
        d.range.startLine >= startLine &&
        d.range.startLine <= endLine,
    );
    return hit?.severity ?? null;
  });
</script>

<div class="group relative">
  <!-- Diagnostic dot in the block gutter. -->
  {#if severity && !active}
    <span
      class="absolute top-3 -left-2 size-1.5 rounded-full {severity === 'error'
        ? 'bg-destructive'
        : 'bg-amber-500'}"
      title={severity}
    ></span>
  {/if}

  {#if active}
    <div class="border-primary/60 bg-muted/40 rounded-lg border">
      <div class="flex items-center justify-between border-b px-2 py-1">
        <span class="text-muted-foreground text-[11px] tracking-wide uppercase">{block.kind}</span>
        <div class="flex items-center gap-1">
          <button
            class="active:bg-accent flex size-7 items-center justify-center rounded-md"
            aria-label="Block options"
            onclick={() => (menuOpen = true)}
          >
            <Icon icon={MoreVerticalIcon} class="size-4" />
          </button>
          <button
            class="active:bg-accent flex size-7 items-center justify-center rounded-md"
            aria-label="Done editing block"
            onclick={() => blocks.commitActive()}
          >
            <Icon icon={Tick02Icon} class="size-4" />
          </button>
        </div>
      </div>
      <BlockEditor {block} />
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="active:bg-accent/40 rounded-lg transition-colors"
      role="button"
      tabindex="0"
      onclick={() => blocks.activate(block.id)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") blocks.activate(block.id);
      }}
      use:longpress={{ onLongpress: () => (menuOpen = true) }}
    >
      {#if showFragment}
        <BlockFragment {extents} {width} />
      {:else if chip}
        <pre
          class="bg-muted text-muted-foreground overflow-x-auto rounded-md px-3 py-2 font-mono text-[13px] leading-relaxed">{source}</pre>
      {:else}
        <p
          class="px-1 py-1 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap {stale
            ? 'text-muted-foreground'
            : ''}"
        >
          {source || " "}
        </p>
      {/if}
    </div>
  {/if}
</div>

<BlockMenu {block} bind:open={menuOpen} />
