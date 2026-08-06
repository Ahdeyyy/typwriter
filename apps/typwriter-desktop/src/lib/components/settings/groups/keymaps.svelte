<script lang="ts">
  // Keymaps pane: every rebindable shortcut, grouped by the scope it applies
  // in. Rows read from the keybinding registry and write through
  // `settings.setKeybinding`, so a change here persists and broadcasts to the
  // editor windows the same way every other setting does.
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    Add01Icon,
    Cancel01Icon,
    Search01Icon,
    Alert02Icon,
  } from "@hugeicons/core-free-icons";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingMatch from "../setting-match.svelte";
  import { getSettingsSearch } from "../search.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import {
    KEY_SECTIONS,
    chordFromEvent,
    chordTokens,
    commandsInScope,
    conflictsFor,
    isCustomized,
    keysFor,
    type KeyCommandDef,
  } from "$lib/keybindings";

  // Bindings we don't own: they come from the VS Code keymap and CodeMirror's
  // own defaults. Listed so the pane still documents them.
  const BUILT_IN: { keys: string; description: string }[] = [
    { keys: "Tab", description: "Indent selection" },
    { keys: "Mod-z", description: "Undo" },
    { keys: "Mod-y", description: "Redo" },
    { keys: "Mod-/", description: "Toggle line comment" },
    { keys: "Enter", description: "Continue the current list item" },
  ];

  let filter = $state("");
  /** Command id whose row is currently waiting for a keystroke. */
  let capturingId = $state<string | null>(null);
  let captureEl = $state<HTMLButtonElement | null>(null);

  const customizedCount = $derived(Object.keys(settings.keybindings).length);

  // The settings-wide search takes over this pane's filter while it's running,
  // so searching "bold" or "Ctrl+S" from the top of the window lands here.
  const search = getSettingsSearch();
  const activeFilter = $derived(search.active ? search.query : filter);

  const sections = $derived.by(() => {
    const needle = activeFilter.trim().toLowerCase();
    return KEY_SECTIONS.map((section) => ({
      ...section,
      commands: commandsInScope(section.scope).filter(
        (command) =>
          !needle ||
          command.label.toLowerCase().includes(needle) ||
          section.title.toLowerCase().includes(needle) ||
          keysFor(command.id).some((chord) =>
            chordTokens(chord, platform.isMac).join("+").toLowerCase().includes(needle),
          ),
      ),
    })).filter((section) => section.commands.length > 0);
  });

  // The capture button has to hold focus to receive keystrokes.
  $effect(() => {
    if (capturingId) captureEl?.focus();
  });

  function startCapture(commandId: string) {
    capturingId = commandId;
  }

  function onCaptureKeydown(event: KeyboardEvent, command: KeyCommandDef) {
    // Swallow everything while capturing: the keystroke is data here, not a
    // shortcut, and the window-level handlers would otherwise act on it.
    event.preventDefault();
    event.stopPropagation();
    const chord = chordFromEvent(event, platform.isMac);
    // A bare modifier press — the user is still building the chord.
    if (!chord) return;
    const keys = keysFor(command.id);
    if (!keys.includes(chord)) {
      settings.setKeybinding(command.id, [...keys, chord]);
    }
    capturingId = null;
  }

  function removeKey(command: KeyCommandDef, chord: string) {
    settings.setKeybinding(
      command.id,
      keysFor(command.id).filter((key) => key !== chord),
    );
  }
</script>

<SettingGroup
  title="Keymaps"
  description="Every shortcut below can be rebound. A command can answer to several key combinations — add as many as you like, or remove them all to switch the command off. Changes apply immediately, in every open window."
  keywords={["shortcuts", "keyboard", "hotkeys", "key bindings", "keys", "rebind"]}
>
  {#snippet aside()}
    {#if customizedCount > 0}
      <Button variant="ghost" size="sm" onclick={() => settings.resetAllKeybindings()}>
        Reset {customizedCount} customised
      </Button>
    {/if}
  {/snippet}

  <!-- `matched` keeps the pane on screen when the settings-wide query hits a
       command or a chord rather than the word "keymaps". -->
  <SettingMatch
    keywords={[
      "shortcuts",
      "keyboard",
      "hotkeys",
      "key bindings",
      "rebind",
      // The non-rebindable list at the bottom isn't filtered, so its labels
      // have to come in as keywords for "undo" and friends to find the pane.
      ...BUILT_IN.map((binding) => binding.description),
    ]}
    matched={sections.length > 0}
  >
  <!-- Hidden while the settings-wide search drives the list: two filter boxes
       over the same list would just be confusing. -->
  {#if !search.active}
    <div class="mb-4 flex items-center gap-2">
      <HugeiconsIcon icon={Search01Icon} class="size-4 shrink-0 text-muted-foreground" />
      <Input bind:value={filter} placeholder="Filter shortcuts…" />
    </div>
  {/if}

  {#if sections.length === 0}
    <p class="rounded-md border border-border px-4 py-6 text-center text-sm text-muted-foreground">
      No shortcuts match "{activeFilter}".
    </p>
  {/if}

  <div class="flex flex-col gap-6">
    {#each sections as section (section.scope)}
      <div>
        <h3 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {section.title}
        </h3>
        <p class="mb-2 text-xs text-muted-foreground">{section.description}</p>

        <div class="overflow-hidden rounded-md border border-border">
          {#each section.commands as command (command.id)}
            {@const keys = keysFor(command.id)}
            {@const conflicts = keys.flatMap((chord) =>
              conflictsFor(command.id, chord).map((other) => ({ chord, other })),
            )}
            <div
              class="flex items-start justify-between gap-4 px-4 py-2.5 not-first:border-t not-first:border-border"
            >
              <div class="min-w-0 pt-1">
                <p class="text-sm">{command.label}</p>
                {#if command.description}
                  <p class="text-xs text-muted-foreground">{command.description}</p>
                {/if}
                {#each conflicts as conflict (conflict.chord + conflict.other.id)}
                  <p class="flex items-center gap-1 text-xs text-destructive">
                    <HugeiconsIcon icon={Alert02Icon} class="size-3.5 shrink-0" />
                    Also bound to "{conflict.other.label}"
                  </p>
                {/each}
              </div>

              <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <!-- Keyed on the chord: a command's chords are de-duplicated
                     when stored, so this is stable and unique. -->
                {#each keys as chord (chord)}
                  <span
                    class="flex items-center gap-1 rounded border border-border bg-muted py-0.5 pl-1 pr-0.5"
                  >
                    <!-- Unkeyed: a chord can legitimately repeat a token. -->
                    {#each chordTokens(chord, platform.isMac) as token, i}
                      {#if i > 0 && !platform.isMac}
                        <span class="text-[10px] text-muted-foreground">+</span>
                      {/if}
                      <kbd
                        class="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] text-foreground"
                      >
                        {token}
                      </kbd>
                    {/each}
                    <button
                      type="button"
                      class="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
                      aria-label="Remove this shortcut from {command.label}"
                      onclick={() => removeKey(command, chord)}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} class="size-3" />
                    </button>
                  </span>
                {/each}

                {#if capturingId === command.id}
                  <button
                    bind:this={captureEl}
                    type="button"
                    class="rounded border border-dashed border-ring px-2 py-1 text-xs text-muted-foreground outline-none"
                    onkeydown={(e) => onCaptureKeydown(e, command)}
                    onblur={() => (capturingId = null)}
                  >
                    Press a key combination…
                  </button>
                {:else}
                  {#if keys.length === 0}
                    <span class="text-xs italic text-muted-foreground">Unbound</span>
                  {/if}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="Add a shortcut for {command.label}"
                    onclick={() => startCapture(command.id)}
                  >
                    <HugeiconsIcon icon={Add01Icon} class="size-4" />
                  </Button>
                {/if}

                {#if isCustomized(command.id)}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 px-1.5 text-xs text-muted-foreground"
                    onclick={() => settings.resetKeybinding(command.id)}
                  >
                    Reset
                  </Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- ── Not rebindable ──────────────────────────────────────────────── -->

  <h3 class="mb-1 mt-6 text-sm font-medium">Editor basics</h3>
  <p class="mb-2 text-xs text-muted-foreground">
    Standard editing keys, provided by CodeMirror's VS Code keymap. These aren't
    configurable.
  </p>
  <div class="overflow-hidden rounded-md border border-border">
    {#each BUILT_IN as binding (binding.keys)}
      <div
        class="flex items-center justify-between gap-4 px-4 py-2 not-first:border-t not-first:border-border"
      >
        <span class="text-sm text-muted-foreground">{binding.description}</span>
        <span class="flex shrink-0 items-center gap-1">
          {#each chordTokens(binding.keys, platform.isMac) as token, i}
            {#if i > 0 && !platform.isMac}
              <span class="text-[10px] text-muted-foreground">+</span>
            {/if}
            <kbd
              class="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground"
            >
              {token}
            </kbd>
          {/each}
        </span>
      </div>
    {/each}
  </div>
  </SettingMatch>
</SettingGroup>
