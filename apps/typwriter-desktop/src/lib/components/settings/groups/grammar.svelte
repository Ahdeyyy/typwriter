<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Delete01Icon,
    RefreshIcon,
    Search01Icon,
    Tick02Icon,
  } from "@hugeicons/core-free-icons";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Button from "$lib/components/ui/button/button.svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SettingMatch from "../setting-match.svelte";
  import { getSettingsSearch } from "../search.svelte";
  import { grammar } from "$lib/stores/grammar.svelte";
  import type { GrammarDialect } from "$lib/types";
  import { toast } from "svelte-sonner";

  const DIALECTS: { id: GrammarDialect; label: string }[] = [
    { id: "american", label: "American" },
    { id: "british", label: "British" },
    { id: "canadian", label: "Canadian" },
    { id: "australian", label: "Australian" },
    { id: "indian", label: "Indian" },
  ];

  let ruleFilter = $state("");
  let newWord = $state("");

  const dialectLabel = $derived(
    DIALECTS.find((d) => d.id === grammar.config.dialect)?.label ?? "American",
  );

  // The settings-wide search takes over the rule filter while it's running, so
  // looking for a rule by name from the top of the window finds it here.
  const search = getSettingsSearch();
  const activeRuleFilter = $derived(search.active ? search.query : ruleFilter);

  const visibleRules = $derived.by(() => {
    const needle = activeRuleFilter.trim().toLowerCase();
    if (!needle) return grammar.rules;
    return grammar.rules.filter(
      (rule) =>
        rule.name.toLowerCase().includes(needle) ||
        rule.description.toLowerCase().includes(needle),
    );
  });

  const overriddenCount = $derived(Object.keys(grammar.config.rules).length);

  // The rule catalog forces Harper's full lint set to be built on the Rust
  // side, so it loads on demand rather than when the settings page opens.
  let rulesRequested = $state(false);

  function loadRules() {
    rulesRequested = true;
    grammar
      .loadRules()
      .mapErr((err) => toast.error(`Could not load rules: ${err}`));
  }

  function addWord() {
    const word = newWord.trim();
    if (!word) return;
    grammar.addWord(word).match(
      () => {
        newWord = "";
      },
      (err) => toast.error(`Could not add word: ${err}`),
    );
  }
</script>

<SettingGroup
  title="Grammar"
  description="Checks prose for spelling, grammar, and style as you write, using Harper. Typst files are read with a parser that understands markup, so code, maths, and raw blocks are left alone. Markdown, plain text, and the data formats Typst can import — JSON, YAML, TOML, CSV, XML, BibTeX — are checked too; source code never is."
  keywords={["spelling", "proofreading", "harper", "lint", "writing style"]}
>
  <div class="flex flex-col gap-3">
    <SettingRow
      label
      title="Check grammar"
      description="Turn the checker off to stop all analysis and clear existing suggestions."
      keywords={["enable", "disable", "turn off", "spelling"]}
    >
      {#snippet control()}
        <Switch
          checked={grammar.config.enabled}
          onCheckedChange={(v) =>
            grammar
              .setEnabled(v)
              .mapErr((err) => toast.error(`Could not save: ${err}`))}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Dialect"
      description="Which English the checker treats as correct. Affects spelling variants like colour/color and regional word choice."
      keywords={["language", "american", "british", "canadian", "australian", "indian", "locale"]}
      dimmed={!grammar.config.enabled}
    >
      {#snippet control()}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger disabled={!grammar.config.enabled}>
            <Button variant="outline" size="sm" class="w-36 justify-between">
              {dialectLabel}
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="w-36">
            {#each DIALECTS as dialect (dialect.id)}
              <DropdownMenu.Item
                onSelect={() =>
                  grammar
                    .setDialect(dialect.id)
                    .mapErr((err) => toast.error(`Could not save: ${err}`))}
              >
                <span class="flex-1">{dialect.label}</span>
                {#if grammar.config.dialect === dialect.id}
                  <HugeiconsIcon icon={Tick02Icon} class="size-4" />
                {/if}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/snippet}
    </SettingRow>
  </div>

  <!-- ── Personal dictionary ─────────────────────────────────────────── -->

  <SettingMatch
    keywords={[
      "Dictionary",
      "custom words",
      "personal dictionary",
      "add a word",
      "ignore word",
      "spelling",
    ]}
  >
    <h3 class="mb-2 mt-6 text-sm font-medium">Dictionary</h3>
    <p class="mb-2 text-xs text-muted-foreground">
      Words here are always treated as correctly spelled. The "Add to dictionary"
      action on a spelling suggestion adds them too.
    </p>

    <div class="mb-3 flex gap-2">
      <Input
        bind:value={newWord}
        placeholder="Add a word…"
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addWord();
          }
        }}
      />
      <Button variant="outline" size="sm" onclick={addWord} disabled={!newWord.trim()}>
        Add
      </Button>
    </div>

    <div class="max-h-72 overflow-y-auto rounded-md border border-border">
      {#if grammar.config.userDictionary.length === 0}
        <p class="px-4 py-6 text-center text-sm text-muted-foreground">
          No custom words yet.
        </p>
      {:else}
        <ul>
          {#each grammar.config.userDictionary as word, i (word)}
            <li
              class="flex items-center gap-3 px-4 py-2 {i > 0
                ? 'border-t border-border'
                : ''}"
            >
              <span class="min-w-0 flex-1 truncate text-sm">{word}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove {word} from the dictionary"
                onclick={() =>
                  grammar
                    .removeWord(word)
                    .mapErr((err) => toast.error(`Could not remove word: ${err}`))}
              >
                <HugeiconsIcon icon={Delete01Icon} class="size-4 text-destructive" />
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </SettingMatch>

  <!-- ── Per-file opt-outs ───────────────────────────────────────────── -->

  {#if grammar.config.disabledFiles.length > 0}
    <SettingMatch keywords={["Files not checked", "excluded", "ignored files", "opt out"]}>
      <h3 class="mb-2 mt-6 text-sm font-medium">Files not checked</h3>
      <p class="mb-2 text-xs text-muted-foreground">
        Switched off individually from the Grammar pane in the sidebar.
      </p>
      <div class="rounded-md border border-border">
        <ul>
          {#each grammar.config.disabledFiles as path, i (path)}
            <li
              class="flex items-center gap-3 px-4 py-2 {i > 0
                ? 'border-t border-border'
                : ''}"
            >
              <span class="min-w-0 flex-1 truncate text-sm">{path}</span>
              <Button
                variant="ghost"
                size="sm"
                onclick={() =>
                  grammar
                    .setFileEnabled(path, true)
                    .mapErr((err) => toast.error(`Could not re-enable: ${err}`))}
              >
                Re-enable
              </Button>
            </li>
          {/each}
        </ul>
      </div>
    </SettingMatch>
  {/if}

  <!-- ── Rules ───────────────────────────────────────────────────────── -->

  <!-- `matched` keeps the block on screen when the settings-wide query hits a
       rule name rather than the word "rules". -->
  <SettingMatch
    keywords={["Rules", "lints", "checks", "harper rules", "style rules"]}
    matched={visibleRules.length > 0}
  >
  <div class="mb-2 mt-6 flex items-center justify-between gap-3">
    <h3 class="text-sm font-medium">Rules</h3>
    {#if overriddenCount > 0}
      <Button
        variant="ghost"
        size="sm"
        onclick={() =>
          grammar
            .resetAllRules()
            .mapErr((err) => toast.error(`Could not reset rules: ${err}`))}
      >
        Reset {overriddenCount} customised
      </Button>
    {/if}
  </div>

  {#if !rulesRequested && grammar.rules.length === 0}
    <div class="rounded-md border border-border px-4 py-6 text-center">
      <p class="text-sm text-muted-foreground">
        Harper ships several hundred rules. Load the list to turn individual
        ones on or off.
      </p>
      <Button variant="outline" size="sm" class="mt-3" onclick={loadRules}>
        Load rules
      </Button>
    </div>
  {:else if grammar.rulesLoading}
    <div
      class="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-6 text-sm text-muted-foreground"
    >
      <HugeiconsIcon icon={RefreshIcon} class="size-4 animate-spin" />
      Loading rules…
    </div>
  {:else}
    <!-- Hidden while the settings-wide search is driving the list: two filter
         boxes fighting over the same list would just be confusing. -->
    {#if !search.active}
      <div class="mb-3 flex items-center gap-2">
        <HugeiconsIcon
          icon={Search01Icon}
          class="size-4 shrink-0 text-muted-foreground"
        />
        <Input bind:value={ruleFilter} placeholder="Filter rules…" />
      </div>
    {/if}

    <div class="max-h-96 overflow-y-auto rounded-md border border-border">
      {#if visibleRules.length === 0}
        <p class="px-4 py-6 text-center text-sm text-muted-foreground">
          No rules match "{activeRuleFilter}".
        </p>
      {:else}
        <ul>
          {#each visibleRules as rule, i (rule.name)}
            <li
              class="flex items-start justify-between gap-4 px-4 py-2.5 {i > 0
                ? 'border-t border-border'
                : ''}"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium">{rule.name}</p>
                {#if rule.description}
                  <p class="text-xs text-muted-foreground">{rule.description}</p>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-2 pt-0.5">
                {#if rule.name in grammar.config.rules}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 px-1.5 text-xs text-muted-foreground"
                    onclick={() =>
                      grammar
                        .resetRule(rule.name)
                        .mapErr((err) => toast.error(`Could not reset: ${err}`))}
                  >
                    Reset
                  </Button>
                {/if}
                <Switch
                  checked={rule.enabled}
                  disabled={!grammar.config.enabled}
                  onCheckedChange={(v) =>
                    grammar
                      .setRuleEnabled(rule.name, v)
                      .mapErr((err) => toast.error(`Could not save: ${err}`))}
                />
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  </SettingMatch>
</SettingGroup>
