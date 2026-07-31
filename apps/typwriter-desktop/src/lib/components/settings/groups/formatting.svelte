<script lang="ts">
  // typstyle's options, one row each. Every change goes through the settings
  // store, which persists to Rust via `set_app_settings` — that swaps the
  // shared typstyle config in place, so the next format in the editor window
  // (manual, format-on-save, or Format workspace) uses the new value.
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings, FORMAT_LIMITS } from "$lib/stores/settings.svelte";

  const indentReadout = $derived(
    `${settings.formatTabSpaces} ${settings.formatTabSpaces === 1 ? "space" : "spaces"}`,
  );
  const widthReadout = $derived(`${settings.formatMaxWidth} cols`);
  const blankLinesReadout = $derived(
    settings.formatBlankLinesUpperBound === 1
      ? "1 line"
      : `${settings.formatBlankLinesUpperBound} lines`,
  );

  // Reflowing prose to a column is meaningless unless whitespace collapses
  // first, so the Rust side forces it on. Show that here rather than letting
  // the switch claim otherwise.
  const collapseForced = $derived(settings.formatWrapText);
</script>

<SettingGroup
  title="Formatting"
  description="How typstyle rewrites your .typ files. These options apply everywhere formatting runs — the editor's format command, format-on-save, and Format workspace."
>
  <div class="flex flex-col gap-3">
    <SettingRow title="Indent width">
      {#snippet description()}
        Spaces per indentation level in formatted output. Separate from the
        editor's own tab width.
      {/snippet}
      {#snippet control()}
        <SliderControl
          min={FORMAT_LIMITS.tabSpaces.min}
          max={FORMAT_LIMITS.tabSpaces.max}
          step={1}
          value={settings.formatTabSpaces}
          onchange={(v) => settings.setFormatTabSpaces(v)}
          readout={indentReadout}
          readoutClass="w-16"
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      title="Maximum line width"
      description="The column typstyle tries to keep lines within before breaking them across lines."
    >
      {#snippet control()}
        <SliderControl
          min={FORMAT_LIMITS.maxWidth.min}
          max={FORMAT_LIMITS.maxWidth.max}
          step={5}
          value={settings.formatMaxWidth}
          onchange={(v) => settings.setFormatMaxWidth(v)}
          readout={widthReadout}
          readoutClass="w-16"
        />
      {/snippet}
    </SettingRow>

    <SettingRow title="Consecutive blank lines">
      {#snippet description()}
        How many blank lines in a row to keep inside code; longer runs are
        collapsed. Blank lines in markup are always left as you wrote them.
      {/snippet}
      {#snippet control()}
        <SliderControl
          min={FORMAT_LIMITS.blankLines.min}
          max={FORMAT_LIMITS.blankLines.max}
          step={1}
          value={settings.formatBlankLinesUpperBound}
          onchange={(v) => settings.setFormatBlankLinesUpperBound(v)}
          readout={blankLinesReadout}
          readoutClass="w-16"
        />
      {/snippet}
    </SettingRow>

    <SettingRow label title="Wrap prose to the line width">
      {#snippet description()}
        Reflow paragraphs so they fit the maximum line width. Off by default —
        it rewrites how your prose is laid out, not just its spacing.
      {/snippet}
      {#snippet control()}
        <Switch
          checked={settings.formatWrapText}
          onCheckedChange={(v) => settings.setFormatWrapText(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      label={!collapseForced}
      title="Collapse whitespace in markup"
      dimmed={collapseForced}
    >
      {#snippet description()}
        {#if collapseForced}
          Always on while prose wrapping is enabled.
        {:else}
          Squash runs of spaces between words down to a single space.
        {/if}
      {/snippet}
      {#snippet control()}
        <Switch
          checked={collapseForced || settings.formatCollapseMarkupSpaces}
          disabled={collapseForced}
          onCheckedChange={(v) => settings.setFormatCollapseMarkupSpaces(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow label title="Sort import items">
      {#snippet description()}
        Alphabetize the items in an <code>#import</code> list.
      {/snippet}
      {#snippet control()}
        <Switch
          checked={settings.formatReorderImportItems}
          onCheckedChange={(v) => settings.setFormatReorderImportItems(v)}
        />
      {/snippet}
    </SettingRow>
  </div>

  <p class="mt-4 text-xs text-muted-foreground">
    Formatting also runs automatically before every save when
    <span class="font-medium">Format before saving</span> is enabled under Saving.
  </p>
</SettingGroup>
