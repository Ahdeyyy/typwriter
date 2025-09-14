<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area"
  type Props = {
    pages: HTMLImageElement[]
    onclick: (event: MouseEvent, page: number, x: number, y: number) => void
  }

  let { onclick, pages }: Props = $props()
</script>

<ScrollArea class="h-95svh w-full">
  <div class="flex flex-col items-center">
    {#if pages && pages.length > 0}
      {#each pages as page, index}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <!-- svelte-ignore a11y_missing_attribute -->
        <img
          src={page.src}
          width={page.width}
          height={page.height}
          onclick={(event) => {
            let rect = (
              event.target as HTMLImageElement
            ).getBoundingClientRect()
            let x = event.clientX - rect.left
            let y = event.clientY - rect.top

            onclick(event, index, x, y)
          }}
          class="not-last:border-b-1 border-black object-fill"
        />
      {/each}
    {:else}
      <p class="text-center">No pages available for preview.</p>
    {/if}
  </div>
</ScrollArea>

<style>
  div {
    height: 94svh;
    width: 100%;
  }
</style>
