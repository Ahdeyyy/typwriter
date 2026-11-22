<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings, type LinkUpdateMode } from "$lib/stores/settings.svelte";
  import { shortcutLabel } from "$lib/keybindings";

  const LINK_MODES: { id: LinkUpdateMode; label: string; hint: string }[] = [
    { id: "always", label: "Always", hint: "Update them right away, with an Undo option" },
    { id: "ask", label: "Ask", hint: "Show the changes and let me decide" },
    { id: "never", label: "Never", hint: "Leave links as they are" },
  ];

  const delayReadout = $derived(
    `${(settings.autoSaveDelayMs / 1000).toFixed(settings.autoSaveDelayMs % 1000 === 0 ? 0 : 2)}s`,
  );

  // Follows whatever "Save current file" is bound to in the Keymaps pane.
  const saveShortcut = $derived(shortcutLabel("editor.save"));
</script>

<SettingGroup
  title="Saving"
  description="Save edits to disk after you stop typing. Disable auto-save to require a manual save{saveShortcut
    ? ` (${saveShortcut})`
    : ''}."
  keywords={["autosave", "auto save", "write to disk", "persist"]}
>
  <div class="flex flex-col gap-3">
    <SettingRow
      label
      title="Auto-save when idle"
      description="Flush unsaved edits after a pause in typing."
      keywords={["autosave", "automatic"]}
    >
      {#snippet control()}
        <Switch
          checked={settings.autoSaveEnabled}
          onCheckedChange={(v) => settings.setAutoSaveEnabled(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Idle delay"
      description="How long to wait after the last keystroke before saving."
      keywords={["autosave", "debounce", "timeout", "seconds"]}
      dimmed={!settings.autoSaveEnabled}
    >
      {#snippet control()}
        <SliderControl
          min={250}
          max={10000}
          step={250}
          value={settings.autoSaveDelayMs}
          disabled={!settings.autoSaveEnabled}
          onchange={(v) => settings.setAutoSaveDelayMs(v)}
          readout={delayReadout}
          readoutClass="w-16"
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Update links when files move"
      keywords={["rename", "move", "broken links", "include", "import", "image", "refactor"]}
    >
      {#snippet description()}
        After you rename or move a file or folder, fix the paths in
        <code>#include</code>, <code>#import</code>, <code>#image</code> and similar calls that point
        to it.
      {/snippet}
      {#snippet control()}
        <div
          class="inline-flex shrink-0 rounded-md border border-border p-0.5"
          role="radiogroup"
          aria-label="Update links when files move"
        >
          {#each LINK_MODES as option (option.id)}
            {@const selected = settings.linkUpdateMode === option.id}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.hint}
              class="rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary {selected
                ? 'bg-primary font-medium text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
              onclick={() => settings.setLinkUpdateMode(option.id)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      {/snippet}
    </SettingRow>

    <SettingRow
      label
      title="Format before saving"
      keywords={["format on save", "typstyle", "autoformat"]}
    >
      {#snippet description()}
        Run typstyle on <code>.typ</code> files immediately before each save,
        using the options under Formatting.
      {/snippet}
      {#snippet control()}
        <Switch
          checked={settings.formatBeforeSave}
          onCheckedChange={(v) => settings.setFormatBeforeSave(v)}
        />
      {/snippet}
    </SettingRow>
  </div>
</SettingGroup>
