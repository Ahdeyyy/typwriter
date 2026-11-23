<!--
  editor/link-review-dialog.svelte

  "Ask" mode for link updates: after a rename or move, lists every path
  literal the move broke and what it would become, and lets the user apply or
  skip them all. Driven entirely by `linkUpdates.review`.
-->
<script lang="ts">
  import * as Dialog from "#lib/components/ui/dialog/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { linkUpdates } from "#lib/stores/link-updates.svelte.ts";
  import { describeLinkCount, literalValue } from "#lib/link-updates.ts";

  const review = $derived(linkUpdates.review);

  function onOpenChange(open: boolean) {
    if (!open) linkUpdates.dismissReview();
  }
</script>

<Dialog.Root open={review !== null} {onOpenChange}>
  <Dialog.Content class="max-w-lg">
    {#if review}
      <Dialog.Header>
        <Dialog.Title>Update links?</Dialog.Title>
        <Dialog.Description>
          {review.label} broke {describeLinkCount(review.updates)}. Update them to the new
          location?
        </Dialog.Description>
      </Dialog.Header>

      <ul class="max-h-72 space-y-3 overflow-y-auto py-1 text-sm">
        {#each review.updates as update (update.path)}
          <li class="space-y-1">
            <p class="truncate font-medium text-foreground" title={update.path}>{update.path}</p>
            <ul class="space-y-0.5 font-mono text-xs">
              {#each update.edits as edit (edit.start)}
                <li class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span class="break-all text-muted-foreground line-through">
                    {literalValue(edit.oldText)}
                  </span>
                  <span class="text-muted-foreground" aria-hidden="true">→</span>
                  <span class="sr-only">becomes</span>
                  <span class="break-all text-foreground">{literalValue(edit.newText)}</span>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => linkUpdates.dismissReview()}>
          Don't update
        </Button>
        <Button type="button" onclick={() => void linkUpdates.confirmReview()}>
          Update links
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
