<script lang="ts">
  // What syncing a workspace with a folder costs, in four short lines. Shown
  // every time a workspace is about to start syncing (new, opened or moved),
  // so nobody opts in without seeing it.
  let { class: className = "" }: { class?: string } = $props();

  const items = [
    "Takes about twice the space on this device",
    "Changes from other devices show up after a few seconds",
    "Uses a little more battery while open",
    "If two devices edit the same file, you choose which to keep",
  ];
</script>

<ul class="text-muted-foreground flex flex-col gap-1.5 text-[13px] leading-snug {className}">
  {#each items as item (item)}
    <li class="flex gap-2">
      <span class="bg-muted-foreground/50 mt-[7px] size-1 shrink-0 rounded-full"></span>
      {item}
    </li>
  {/each}
</ul>
