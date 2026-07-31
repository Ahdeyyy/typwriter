<script lang="ts">
  import { onMount } from "svelte";
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { Alert01Icon } from "@hugeicons/core-free-icons";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import FontPicker from "../font-picker.svelte";
  import SliderControl from "../slider-control.svelte";
  import { settings, BUNDLED_EDITOR_FONTS } from "$lib/stores/settings.svelte";
  import { systemFonts, withoutBundled, type FontGroup } from "$lib/stores/system-fonts.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import { lspClient } from "$lib/lsp/client.svelte";

  // tinymist may be installed (or removed) while the app runs, so re-probe every
  // time this pane opens rather than trusting a launch-time answer.
  onMount(() => {
    if (!platform.isMobile) void lspClient.probeInstalled();
    // The OS font scan takes a moment; start it with the pane, not on click.
    void systemFonts.load();
  });

  // Code fonts should be monospace, so installed monospace families come right
  // after the bundled ones — but the rest stay reachable, since the user may
  // well know their font is fixed-width even when it doesn't say so.
  const editorFontGroups = $derived<FontGroup[]>([
    { label: "Typwriter fonts", families: BUNDLED_EDITOR_FONTS },
    {
      label: "Installed monospace",
      families: withoutBundled(systemFonts.monospaceNames, BUNDLED_EDITOR_FONTS),
    },
    {
      label: "Other installed fonts",
      families: withoutBundled(systemFonts.proportionalNames, BUNDLED_EDITOR_FONTS),
    },
  ]);

  const tinymistInstalled = $derived(lspClient.isInstalled === true);
  // tinymist embeds its own Typst compiler. When that differs from the one the
  // app compiles with, the server still works — its answers just may not match
  // what gets rendered — so this is a warning, never a block on the toggle.
  const typstMismatch = $derived(lspClient.typstMismatch);
  const tinymistDotClass = $derived(
    lspClient.isInstalled === null
      ? "bg-muted-foreground/40"
      : !lspClient.isInstalled
        ? "bg-destructive"
        : typstMismatch
          ? "bg-yellow-500"
          : "bg-green-500",
  );
  const tinymistStatusLabel = $derived.by(() => {
    if (lspClient.isInstalled === null) return "Checking for tinymist…";
    if (!lspClient.isInstalled) return "tinymist not found on PATH — install it to enable this";
    const name = lspClient.installedVersion ? `tinymist ${lspClient.installedVersion}` : "tinymist";
    // Older builds don't report the Typst they target; show what we have.
    return lspClient.installedTypstVersion
      ? `${name} · Typst ${lspClient.installedTypstVersion}`
      : `${name} found`;
  });
</script>

<SettingGroup
  title="Editor"
  description="How the code editor looks and behaves while you type."
>
  <div class="flex flex-col gap-3">
    <SettingRow
      title="Editor font"
      description="Font used in the code editor. Fonts installed on this device are listed alongside the bundled ones."
    >
      {#snippet control()}
        <FontPicker
          groups={editorFontGroups}
          loading={systemFonts.loading}
          value={settings.editorFontFamily}
          onselect={(f) => settings.setEditorFontFamily(f)}
          fallback="monospace"
        />
      {/snippet}
    </SettingRow>

    <SettingRow title="Editor font size" description="Between 8 and 32 pixels.">
      {#snippet control()}
        <SliderControl
          min={8}
          max={32}
          step={1}
          value={settings.editorFontSize}
          onchange={(v) => settings.setEditorFontSize(v)}
          readout="{settings.editorFontSize}px"
        />
      {/snippet}
    </SettingRow>

    <SettingRow label title="Line numbers" description="Show a gutter with line numbers.">
      {#snippet control()}
        <Switch
          checked={settings.showLineNumbers}
          onCheckedChange={(v) => settings.setShowLineNumbers(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow
      label
      title="Indentation markers"
      description="Faint vertical guides showing indentation levels."
    >
      {#snippet control()}
        <Switch
          checked={settings.showIndentationMarkers}
          onCheckedChange={(v) => settings.setShowIndentationMarkers(v)}
        />
      {/snippet}
    </SettingRow>

    <SettingRow label title="Spell check" description="Underline misspelled words in prose.">
      {#snippet control()}
        <Switch checked={settings.spellcheck} onCheckedChange={(v) => settings.setSpellcheck(v)} />
      {/snippet}
    </SettingRow>

    <SettingRow
      label
      title="Word wrap"
      description="Wrap long lines instead of scrolling horizontally."
    >
      {#snippet control()}
        <Switch checked={settings.wordWrap} onCheckedChange={(v) => settings.setWordWrap(v)} />
      {/snippet}
    </SettingRow>

    <SettingRow title="Tab width" description="Number of spaces a tab character represents.">
      {#snippet control()}
        <SliderControl
          min={1}
          max={8}
          step={1}
          value={settings.tabWidth}
          onchange={(v) => settings.setTabWidth(v)}
          readout={String(settings.tabWidth)}
          readoutClass="w-6"
        />
      {/snippet}
    </SettingRow>

    {#if !platform.isMobile}
      <SettingRow
        label={tinymistInstalled}
        class={tinymistInstalled ? "" : "cursor-not-allowed"}
        title="Typst language server"
        description="Use tinymist for completion, hover, and diagnostics when it's installed."
      >
        <!-- Availability indicator: green once the tinymist CLI is found on
             PATH, amber when it's found but targets a different Typst than the
             app bundles, red when it isn't found at all (the switch is then
             disabled — enabling it could not do anything). -->
        <p class="mt-1 flex items-center gap-1.5 text-xs">
          <span class="size-2 shrink-0 rounded-full {tinymistDotClass}" aria-hidden="true"></span>
          <span class={tinymistInstalled ? "text-muted-foreground" : "text-destructive"}>
            {tinymistStatusLabel}
          </span>
          <button
            type="button"
            class="text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            disabled={lspClient.probing}
            onclick={(e) => {
              e.preventDefault();
              void lspClient.probeInstalled();
            }}
          >
            Re-check
          </button>
        </p>
        {#if typstMismatch}
          <p
            class="mt-1.5 flex items-start gap-1.5 text-xs text-yellow-700 dark:text-yellow-400"
            role="status"
          >
            <HugeiconsIcon
              icon={Alert01Icon}
              class="mt-px size-3.5 shrink-0 text-yellow-500"
              aria-hidden="true"
            />
            <span>
              This app compiles with Typst {lspClient.bundledTypstVersion}. Update tinymist to a
              build that targets it — until then completion, hover, and diagnostics may not match
              what actually renders.
            </span>
          </p>
        {/if}
        {#snippet control()}
          <Switch
            checked={settings.useLsp && tinymistInstalled}
            disabled={!tinymistInstalled}
            onCheckedChange={(v) => settings.setUseLsp(v)}
          />
        {/snippet}
      </SettingRow>
    {/if}
  </div>
</SettingGroup>
