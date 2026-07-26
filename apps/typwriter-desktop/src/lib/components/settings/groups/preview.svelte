<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings } from "$lib/stores/settings.svelte";
</script>

<SettingGroup title="Preview" description="Defaults applied each time you open a workspace.">
  <div class="flex flex-col gap-3">
    <SettingRow
      label
      title="Show preview pane on open"
      description="Start the workspace with the preview pane visible."
    >
      {#snippet control()}
        <Switch
          checked={settings.defaultPreviewVisible}
          onCheckedChange={(v) => settings.setDefaultPreviewVisible(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Default zoom"
      description="Initial zoom applied to the preview on each launch."
    >
      {#snippet control()}
        <SliderControl
          min={0.5}
          max={4}
          step={0.25}
          value={settings.defaultPreviewZoom}
          onchange={(v) => settings.setDefaultPreviewZoom(v)}
          readout="{Math.round(settings.defaultPreviewZoom * 100)}%"
        />
      {/snippet}
    </SettingRow>
  </div>
</SettingGroup>
