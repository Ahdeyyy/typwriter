<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings } from "$lib/stores/settings.svelte";
</script>

<SettingGroup
  title="History"
  description="Typwriter records restore points automatically so you can roll back. Manual restore points from the timeline always work regardless of these toggles."
>
  <div class="flex flex-col gap-3">
    <SettingRow
      label
      title="Snapshot on save"
      description="Record a restore point each time a file is saved."
    >
      {#snippet control()}
        <Switch
          checked={settings.autoSnapshotOnSave}
          onCheckedChange={(v) => settings.setAutoSnapshotOnSave(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      label
      title="Snapshot on successful compile"
      description="Record a restore point after each successful preview compile."
    >
      {#snippet control()}
        <Switch
          checked={settings.autoSnapshotOnCompile}
          onCheckedChange={(v) => settings.setAutoSnapshotOnCompile(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Minimum interval between snapshots"
      description="Throttle automatic snapshots so they don't fire on every keystroke compile. Set to 0 for no throttle."
    >
      {#snippet control()}
        <SliderControl
          min={0}
          max={600}
          step={5}
          value={settings.autoSnapshotMinIntervalSeconds}
          onchange={(v) => settings.setAutoSnapshotMinIntervalSeconds(v)}
          readout={settings.autoSnapshotMinIntervalSeconds === 0
            ? "off"
            : `${settings.autoSnapshotMinIntervalSeconds}s`}
          readoutClass="w-16"
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Keep most recent auto-snapshots"
      description="Cap on auto-snapshots from save / compile. Manual restore points and the initial / pre-restore safety points are never pruned. Set to 0 for unlimited."
    >
      {#snippet control()}
        <SliderControl
          min={0}
          max={500}
          step={10}
          value={settings.snapshotRetentionMaxCount}
          onchange={(v) => settings.setSnapshotRetentionMaxCount(v)}
          readout={settings.snapshotRetentionMaxCount === 0
            ? "unlimited"
            : String(settings.snapshotRetentionMaxCount)}
          readoutClass="w-20"
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Discard auto-snapshots older than"
      description="Maximum age (in days) for auto-snapshots before they're swept on the next snapshot. Manual / initial / pre-restore points are exempt. Set to 0 for unlimited."
    >
      {#snippet control()}
        <SliderControl
          min={0}
          max={365}
          step={1}
          value={settings.snapshotRetentionMaxDays}
          onchange={(v) => settings.setSnapshotRetentionMaxDays(v)}
          readout={settings.snapshotRetentionMaxDays === 0
            ? "unlimited"
            : `${settings.snapshotRetentionMaxDays}d`}
          readoutClass="w-20"
        />
      {/snippet}
    </SettingRow>
  </div>
</SettingGroup>
