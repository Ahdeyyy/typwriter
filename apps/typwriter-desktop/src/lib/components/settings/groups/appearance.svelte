<script lang="ts">
  import { onMount } from "svelte";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SettingMatch from "../setting-match.svelte";
  import ColorSchemePicker from "../color-scheme-picker.svelte";
  import ThemeGrid from "../theme-grid.svelte";
  import FontPicker from "../font-picker.svelte";
  import { settings, BUNDLED_UI_FONTS } from "$lib/stores/settings.svelte";
  import { systemFonts, withoutBundled, type FontGroup } from "$lib/stores/system-fonts.svelte";

  // The OS font scan takes a moment, so kick it off as soon as this pane opens
  // rather than when the picker is first clicked.
  onMount(() => {
    void systemFonts.load();
  });

  // The theme names only exist on the cards, so the sections carry them as
  // keywords — searching "gruvbox" should surface the theme grid, searching
  // "mode" or "dark" the colour scheme cards.
  const schemeKeywords = ["mode", "light mode", "dark mode", "system", "colour scheme", "color scheme"];
  const themeKeywords = [
    "theme",
    "palette",
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
  description="How Typwriter itself looks. Pick a colour scheme and a theme."
  keywords={["theme", "colours", "colors", "look", "interface", "dark mode", "light mode"]}
>
  <div class="flex flex-col gap-6">
    <SettingMatch keywords={schemeKeywords} class="flex flex-col gap-3">
      <h3 class="text-sm font-medium">Color scheme</h3>
      <ColorSchemePicker />
    </SettingMatch>

    <SettingMatch keywords={themeKeywords} class="flex flex-col gap-3">
      <h3 class="text-sm font-medium">Themes</h3>
      <ThemeGrid />
    </SettingMatch>

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
