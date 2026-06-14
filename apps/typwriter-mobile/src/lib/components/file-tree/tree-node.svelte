<script lang="ts">
  import type { SvelteSet } from "svelte/reactivity";
  import {
    ArrowRight01Icon,
    Folder01Icon,
    FolderOpenIcon,
    File02Icon,
    Image01Icon,
    File01Icon,
    StarIcon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { longpress } from "$lib/actions/longpress";
  import type { FileNode } from "$lib/ipc/types";
  import Self from "./tree-node.svelte";

  let {
    node,
    expanded,
    mainFile,
    depth = 0,
    onOpenFile,
    onLongpress,
  }: {
    node: FileNode;
    expanded: SvelteSet<string>;
    mainFile: string | null;
    depth?: number;
    onOpenFile: (relPath: string) => void;
    onLongpress: (node: FileNode) => void;
  } = $props();

  const isOpen = $derived(expanded.has(node.relPath));

  function imageExt(name: string): boolean {
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);
  }

  // Tap-vs-scroll: a bare `onclick` fired even when the gesture was a vertical
  // scroll of the tree, instantly opening a file. Only act on a real tap (the
  // finger barely moved between pointerdown and pointerup).
  let startX = 0;
  let startY = 0;
  const TAP_SLOP = 10;

  function onPointerDown(e: PointerEvent) {
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerUp(e: PointerEvent) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > TAP_SLOP) return;
    if (node.isDir) {
      if (isOpen) expanded.delete(node.relPath);
      else expanded.add(node.relPath);
    } else {
      onOpenFile(node.relPath);
    }
  }
</script>

<div class="select-none">
  <button
    class="active:bg-accent active:text-accent-foreground flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors"
    style="padding-left: {depth * 0.75 + 0.5}rem;"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    use:longpress={{ onLongpress: () => onLongpress(node) }}
  >
    {#if node.isDir}
      <Icon
        icon={ArrowRight01Icon}
        class="size-3.5 shrink-0 transition-transform {isOpen ? 'rotate-90' : ''}"
      />
      {#if isOpen}
        <Icon icon={FolderOpenIcon} class="text-muted-foreground size-4 shrink-0" />
      {:else}
        <Icon icon={Folder01Icon} class="text-muted-foreground size-4 shrink-0" />
      {/if}
    {:else}
      <span class="w-3.5 shrink-0"></span>
      {#if imageExt(node.name)}
        <Icon icon={Image01Icon} class="text-muted-foreground size-4 shrink-0" />
      {:else if node.name.endsWith(".typ")}
        <Icon icon={File02Icon} class="text-muted-foreground size-4 shrink-0" />
      {:else}
        <Icon icon={File01Icon} class="text-muted-foreground size-4 shrink-0" />
      {/if}
    {/if}
    <span class="min-w-0 flex-1 truncate">{node.name}</span>
    {#if !node.isDir && node.relPath === mainFile}
      <Icon icon={StarIcon} class="text-primary size-3.5 shrink-0" />
    {/if}
  </button>

  {#if node.isDir && isOpen}
    {#each node.children as child (child.relPath)}
      <Self node={child} {expanded} {mainFile} depth={depth + 1} {onOpenFile} {onLongpress} />
    {/each}
  {/if}
</div>
