<script lang="ts">
  import type { SvelteSet } from "svelte/reactivity";
  import { CaretRight, Folder, FolderOpen, FileText, Image, File, Star } from "phosphor-svelte";
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
</script>

<div class="select-none">
  <button
    class="active:bg-accent active:text-accent-foreground flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors"
    style="padding-left: {depth * 0.75 + 0.5}rem;"
    onclick={() => {
      if (node.isDir) {
        if (isOpen) expanded.delete(node.relPath);
        else expanded.add(node.relPath);
      } else {
        onOpenFile(node.relPath);
      }
    }}
    use:longpress={{ onLongpress: () => onLongpress(node) }}
  >
    {#if node.isDir}
      <CaretRight class="size-3 shrink-0 transition-transform {isOpen ? 'rotate-90' : ''}" />
      {#if isOpen}
        <FolderOpen class="text-muted-foreground size-4 shrink-0" weight="duotone" />
      {:else}
        <Folder class="text-muted-foreground size-4 shrink-0" weight="duotone" />
      {/if}
    {:else}
      <span class="w-3 shrink-0"></span>
      {#if imageExt(node.name)}
        <Image class="text-muted-foreground size-4 shrink-0" />
      {:else if node.name.endsWith(".typ")}
        <FileText class="text-muted-foreground size-4 shrink-0" />
      {:else}
        <File class="text-muted-foreground size-4 shrink-0" />
      {/if}
    {/if}
    <span class="min-w-0 flex-1 truncate">{node.name}</span>
    {#if !node.isDir && node.relPath === mainFile}
      <Star class="text-primary size-3 shrink-0" weight="fill" />
    {/if}
  </button>

  {#if node.isDir && isOpen}
    {#each node.children as child (child.relPath)}
      <Self node={child} {expanded} {mainFile} depth={depth + 1} {onOpenFile} {onLongpress} />
    {/each}
  {/if}
</div>
