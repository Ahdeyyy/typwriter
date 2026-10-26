<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import SettingGroup from "../setting-group.svelte";
  import SettingRow from "../setting-row.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { shortcutLabel } from "$lib/keybindings";
</script>

<SettingGroup
  title="Accessibility"
  description="Screen reader and keyboard navigation preferences. Labels, headings, and keyboard access are always available."
  keywords={["NVDA", "assistive technology", "tab focus"]}
>
  <SettingRow
    label
    title="Screen reader mode"
    description="Let Tab and Shift+Tab move out of the source editor instead of indenting. Reserve Control+Alt navigation keys for assistive technology, while keeping AltGr typing available. Applies to open editors and the tutorial immediately."
    keywords={["keyboard trap", "indent", "shortcuts", "CodeMirror"]}
  >
    {#snippet control()}
      <Switch
        aria-label="Screen reader mode"
        checked={settings.screenReaderMode}
        onCheckedChange={(value) => settings.setScreenReaderMode(value)}
      />
    {/snippet}
  </SettingRow>

  <h3 class="mb-2 mt-6 text-sm font-medium">Navigating with NVDA</h3>
  <ul class="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
    <li>Use NVDA+Space to switch between browse mode and editing in the source editor.</li>
    <li>In browse mode, use D for landmarks, H for headings, and 1–6 for a heading level. Hold Shift to move backwards. NVDA+F7 opens the elements list.</li>
    <li>With screen reader mode off, press Escape, then Tab to leave the editor. If a popup is open, dismiss it with Escape first.</li>
    <li>
      Toggle screen reader mode in the command palette
      {#if shortcutLabel("global.toggleScreenReaderMode")}
        or with {shortcutLabel("global.toggleScreenReaderMode")}
      {/if}.
      Change its shortcut in Keymaps if it conflicts with your setup.
    </li>
    <li>The document preview contains page images. Read and edit the document in the source editor; image descriptions identify pages and do not reproduce their text.</li>
  </ul>
</SettingGroup>
