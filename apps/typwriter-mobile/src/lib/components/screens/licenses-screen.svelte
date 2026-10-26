<script lang="ts">
  import { onMount } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import type { LicenseCatalog } from "$lib/licenses/types";
  import catalogUrl from "$lib/licenses/catalog.json?url";

  let catalog = $state.raw<LicenseCatalog | null>(null);
  let failed = $state(false);
  let query = $state("");
  let expanded = $state<Record<string, boolean>>({});
  let visibleCount = $state(50);
  const search = $derived(query.trim().toLowerCase());
  const matches = $derived(catalog?.packages.filter((pkg) =>
    `${pkg.name} ${pkg.version} ${pkg.license} ${pkg.ecosystem}`.toLowerCase().includes(search)) ?? []);
  const visible = $derived(matches.slice(0, visibleCount));

  async function loadLicenses() {
    failed = false;
    try {
      // Keep the catalog out of the editor's startup bundle. It is still
      // packaged in the APK and works entirely offline.
      const response = await fetch(catalogUrl);
      if (!response.ok) throw new Error("License catalog unavailable");
      catalog = await response.json() as LicenseCatalog;
    } catch {
      failed = true;
    }
  }

  onMount(() => { void loadLicenses(); });
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 flex-col gap-3 border-b p-4">
    <p class="text-muted-foreground text-xs leading-relaxed">
      Licenses and notices for the packages Typwriter depends on directly,
      including its libraries and build tools.
    </p>
    <Input
      type="search"
      aria-label="Search dependencies or licenses"
      placeholder="Search dependencies or licenses"
      class="h-10 text-base"
      bind:value={query}
      oninput={() => { visibleCount = 50; }}
    />
    {#if catalog}
      <p class="text-muted-foreground text-xs" role="status">
        {matches.length} of {catalog.packages.length} direct dependencies
      </p>
    {/if}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
    style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
    {#if failed}
      <div class="flex flex-col items-start gap-3" role="alert">
        <p class="text-muted-foreground text-sm">Couldn't load the licenses.</p>
        <Button variant="secondary" onclick={loadLicenses}>Try again</Button>
      </div>
    {:else if !catalog}
      <p class="text-muted-foreground text-sm" role="status">Loading licenses…</p>
    {:else if matches.length === 0}
      <p class="text-muted-foreground text-sm">No dependencies match “{query}”.</p>
    {:else}
      <div class="flex flex-col gap-2">
        {#each visible as pkg (`${pkg.ecosystem}/${pkg.name}/${pkg.version}`)}
          {@const id = `${pkg.ecosystem}/${pkg.name}/${pkg.version}`}
          <details class="rounded-lg border" open={expanded[id] ?? false}
            ontoggle={(event) => { expanded[id] = event.currentTarget.open; }}>
            <summary class="cursor-pointer rounded-lg p-3 focus-visible:outline-ring">
              <span class="ml-1 break-words text-sm font-medium">{pkg.name}</span>
              <span class="text-muted-foreground mt-1 block pl-4 text-xs">
                {pkg.version} · {pkg.ecosystem} · {pkg.license}
              </span>
            </summary>
            <!-- Only mount long legal text while expanded. -->
            {#if expanded[id]}
              {#each pkg.notices as notice (notice.title + notice.text)}
                <div class="border-t p-3">
                  <h3 class="text-muted-foreground mb-2 break-words text-xs font-medium">{notice.title}</h3>
                  <pre class={[
                    "font-sans text-xs leading-relaxed whitespace-pre-wrap",
                    "break-words select-text",
                  ]}>{catalog.texts[notice.text]}</pre>
                </div>
              {/each}
            {/if}
          </details>
        {/each}
        {#if visibleCount < matches.length}
          <Button variant="secondary" class="min-h-11" onclick={() => { visibleCount += 50; }}>
            Show more dependencies
          </Button>
        {/if}
      </div>
    {/if}
  </div>
</div>
