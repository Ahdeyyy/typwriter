<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Cancel01Icon } from "@hugeicons/core-free-icons";
  import Icon from "#lib/components/icon.svelte";
  import { Input } from "#lib/components/ui/input/index.ts";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { settings } from "#lib/stores/settings.svelte.ts";

  /** Rows mounted at once; a long dictionary pages in like the licenses list. */
  const PAGE = 100;

  let query = $state("");
  let visibleCount = $state(PAGE);
  const search = $derived(query.trim().toLowerCase());
  const words = $derived(settings.spellIgnoredWords);
  const matches = $derived(search ? words.filter((w) => w.toLowerCase().includes(search)) : words);
  const visible = $derived(matches.slice(0, visibleCount));

  function remove(word: string) {
    settings.removeSpellIgnoredWord(word);
    // One tap removes, so make it cheap to take back.
    toast(`Removed “${word}”`, {
      action: { label: "Undo", onClick: () => settings.addSpellIgnoredWord(word) },
    });
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 flex-col gap-3 border-b p-4">
    <p class="text-muted-foreground text-xs leading-relaxed">
      Words you've added are never marked as misspelled. Remove one to check it again.
    </p>
    {#if words.length > 0}
      <Input
        type="search"
        aria-label="Search your dictionary"
        placeholder="Search your dictionary"
        class="h-10 text-base"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        bind:value={query}
        oninput={() => { visibleCount = PAGE; }}
      />
      <p class="text-muted-foreground text-xs tabular-nums" role="status">
        {search ? `${matches.length} of ${words.length}` : words.length}
        {words.length === 1 ? "word" : "words"}
      </p>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2"
    style="padding-bottom: calc(var(--safe-bottom) + 1rem);">
    {#if words.length === 0}
      <p class="text-muted-foreground py-2 text-sm">
        Your dictionary is empty. Tap a flagged word in the editor and choose “Add to dictionary”.
      </p>
    {:else if matches.length === 0}
      <p class="text-muted-foreground py-2 text-sm">No words match “{query}”.</p>
    {:else}
      <ul class="flex flex-col divide-y">
        {#each visible as word (word)}
          <li class="flex min-h-11 items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm select-text">{word}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-11 shrink-0"
              aria-label={`Remove ${word} from your dictionary`}
              onclick={() => remove(word)}
            >
              <Icon icon={Cancel01Icon} class="text-muted-foreground size-4" />
            </Button>
          </li>
        {/each}
      </ul>
      {#if visibleCount < matches.length}
        <Button variant="secondary" class="mt-2 min-h-11 w-full" onclick={() => { visibleCount += PAGE; }}>
          Show more words
        </Button>
      {/if}
    {/if}
  </div>
</div>
