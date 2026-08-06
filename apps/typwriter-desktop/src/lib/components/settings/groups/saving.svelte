<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { shortcutLabel } from "$lib/keybindings";

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
