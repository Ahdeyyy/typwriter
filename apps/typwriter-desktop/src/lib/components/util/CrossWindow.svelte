<!--
  Markup-driven wrapper around `crossWindowState`. The children snippet is
  rendered unchanged — this is NOT a DOM portal. It just keeps the bound
  `value` in sync with every other Tauri window that mounted a `<CrossWindow>`
  with the same `name`.

  Usage:
    let zoom = $state(2.0);
    <CrossWindow name="preview.zoom" bind:value={zoom}>
      {#snippet children()}
        <ZoomSlider bind:value={zoom} />
      {/snippet}
    </CrossWindow>

  For class-singleton stores, prefer the `crossWindowState` factory directly.
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { onDestroy } from "svelte";

  import { crossWindowState } from "$lib/ipc/cross-window-state.svelte";

  let {
    name,
    value = $bindable(),
    children,
  }: {
    name: string;
    value: T;
    children?: Snippet;
  } = $props();

  // `name` is treated as immutable — the sync key identifies the channel
  // and cannot change at runtime without tearing down + recreating the
  // listener. Capturing the initial value is intentional.
  // svelte-ignore state_referenced_locally
  const sync = crossWindowState<T>(name, value);

  // Local -> remote: when the parent mutates `value`, broadcast.
  $effect(() => {
    if (!Object.is(value, sync.value)) sync.set(value);
  });

  // Remote -> local: when a peer writes, mirror into the bound `value`.
  $effect(() => {
    if (!Object.is(sync.value, value)) value = sync.value;
  });

  onDestroy(() => sync.destroy());
</script>

{@render children?.()}
