<script lang="ts">
  import { onMount } from "svelte";
  import { SunIcon, Moon02Icon } from "@hugeicons/core-free-icons";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import ThemePicker from "../theme-picker.svelte";
  import FontPicker from "../font-picker.svelte";
  import ModeControl from "../mode-control.svelte";
  import { settings, BUNDLED_UI_FONTS } from "$lib/stores/settings.svelte";
  import { systemFonts, withoutBundled, type FontGroup } from "$lib/stores/system-fonts.svelte";

  // The OS font scan takes a moment, so kick it off as soon as this pane opens
  // rather than when the picker is first clicked.
  onMount(() => {
    void systemFonts.load();
  });

  const uiFontGroups = $derived<FontGroup[]>([
    { label: "Typwriter fonts", families: BUNDLED_UI_FONTS },
    {
      label: "Installed on this device",
      families: withoutBundled(systemFonts.names, BUNDLED_UI_FONTS),
    },
  ]);
</script>

<SettingGroup
  title="Appearance"
  description="How Typwriter itself looks. Pick light or dark, then a palette for each."
>
  <div class="flex flex-col gap-6">
    <SettingRow
      title="Mode"
      description="Follow the system setting, or pin Typwriter to light or dark."
    >
      {#snippet control()}
        <ModeControl />
      {/snippet}
    </SettingRow>

    <div class="grid gap-4 md:grid-cols-2">
      <ThemePicker
        title="Light mode palette"
        icon={SunIcon}
        selected={settings.lightTheme}
        onselect={(id) => settings.setLightTheme(id)}
      />
      <ThemePicker
        title="Dark mode palette"
        icon={Moon02Icon}
        dark
        selected={settings.darkTheme}
        onselect={(id) => settings.setDarkTheme(id)}
      />
    </div>

    <SettingRow
      title="UI font"
      description="Used across the app interface. Fonts installed on this device are listed alongside the bundled ones."
    >
      {#snippet control()}
        <FontPicker
          groups={uiFontGroups}
          loading={systemFonts.loading}
          value={settings.uiFontFamily}
          onselect={(f) => settings.setUiFontFamily(f)}
        />
      {/snippet}
    </SettingRow>
  </div>
</SettingGroup>
