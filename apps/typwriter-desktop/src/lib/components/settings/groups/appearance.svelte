<script lang="ts">
  import { onMount } from "svelte";
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

  // The palette names only exist inside the dropdown, so the rows carry them as
  // keywords — searching "gruvbox" should still surface both palette rows.
  const paletteKeywords = [
    "theme",
    "palette",
    "colour scheme",
    "color scheme",
    "nord",
    "dracula",
    "solarized",
    "catppuccin",
    "rose pine",
    "gruvbox",
    "glass",
  ];

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
  keywords={["theme", "colours", "colors", "look", "interface", "dark mode", "light mode"]}
>
  <div class="flex flex-col gap-6">
    <SettingRow
      title="Mode"
      description="Follow the system setting, or pin Typwriter to light or dark."
      keywords={["theme", "dark", "light", "system"]}
    >
      {#snippet control()}
        <ModeControl />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Light mode palette"
      description="Colours used when Typwriter is in light mode."
      keywords={paletteKeywords}
    >
      {#snippet control()}
        <ThemePicker selected={settings.lightTheme} onselect={(id) => settings.setLightTheme(id)} />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Dark mode palette"
      description="Colours used when Typwriter is in dark mode."
      keywords={paletteKeywords}
    >
      {#snippet control()}
        <ThemePicker dark selected={settings.darkTheme} onselect={(id) => settings.setDarkTheme(id)} />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="UI font"
      description="Used across the app interface. Fonts installed on this device are listed alongside the bundled ones."
      keywords={["typeface", "family", "interface font"]}
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
