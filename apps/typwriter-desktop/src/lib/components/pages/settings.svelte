<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import {
    ArrowLeft01Icon,
    Folder01Icon,
    FolderAddIcon,
    Delete01Icon,
    PaintBrush01Icon,
    TextFontIcon,
    SunIcon,
    Moon02Icon,
    RefreshIcon,
    Refresh01Icon,
    EyeIcon,
    FileCodeIcon,
    FloppyDiskIcon,
    GitCommitIcon,
  } from "@hugeicons/core-free-icons";
  import Button from "$lib/components/ui/button/button.svelte";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import * as ScrollArea from "$lib/components/ui/scroll-area/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import Titlebar from "$lib/components/titlebar/titlebar.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { platform } from "$lib/stores/platform.svelte";
  import {
    settings,
    THEMES,
    BUNDLED_UI_FONTS,
    BUNDLED_EDITOR_FONTS,
    type ThemeId,
  } from "$lib/stores/settings.svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { AndroidFs } from "tauri-plugin-android-fs-api";
  import { importFontDirectoryUri, safTreeUriToPath } from "$lib/ipc/commands";
  import { toast } from "svelte-sonner";
  import { logError } from "$lib/logger";

  let fontFilter = $state("");
  let editorFontFilter = $state("");
  let uiFontOpen = $state(false);
  let editorFontOpen = $state(false);

  const filteredUiFonts = $derived.by(() => {
    const q = fontFilter.trim().toLowerCase();
    if (!q) return BUNDLED_UI_FONTS;
    return BUNDLED_UI_FONTS.filter((f) => f.toLowerCase().includes(q));
  });

  const filteredEditorFonts = $derived.by(() => {
    const q = editorFontFilter.trim().toLowerCase();
    if (!q) return BUNDLED_EDITOR_FONTS;
    return BUNDLED_EDITOR_FONTS.filter((f) => f.toLowerCase().includes(q));
  });

  async function pickFolder(): Promise<string | null> {
    if (platform.isMobile) {
      try {
        const uri = await AndroidFs.showOpenDirPicker({ localOnly: true });
        if (!uri) return null;
        const result = await safTreeUriToPath(uri.uri);
        if (result.isErr()) {
          toast.error(`Couldn't use that folder: ${result.error}`);
          return null;
        }
        return result.value;
      } catch (err) {
        logError("mobile folder picker failed:", err);
        toast.error(`Folder picker failed: ${err}`);
        return null;
      }
    }
    const selected = await openDialog({ directory: true, multiple: false });
    return (selected as string | null) ?? null;
  }

  async function handleAddFontDir() {
    // Mobile takes a separate path: typst-kit's FontSearcher can't scan SAF
    // tree paths, so we copy the picked folder's font files into app-private
    // storage and register THAT path with the font search instead.
    if (platform.isMobile) {
      try {
        const uri = await AndroidFs.showOpenDirPicker({ localOnly: true });
        if (!uri) return;
        const imported = await importFontDirectoryUri({
          uri: uri.uri,
          documentTopTreeUri: uri.documentTopTreeUri ?? null,
        });
        if (imported.isErr()) {
          toast.error(`Failed to import fonts: ${imported.error}`);
          return;
        }
        const result = await settings.addFontDirectory(imported.value);
        result.match(
          () => toast.success("Fonts imported — reloading…"),
          (err) => toast.error(`Failed to add font directory: ${err}`),
        );
      } catch (err) {
        logError("mobile font import failed:", err);
        toast.error(`Folder picker failed: ${err}`);
      }
      return;
    }

    const folder = await pickFolder();
    if (!folder) return;
    const result = await settings.addFontDirectory(folder);
    result.match(
      () => toast.success("Font directory added — reloading fonts…"),
      (err) => toast.error(`Failed to add font directory: ${err}`),
    );
  }

  async function handleRemoveFontDir(dir: string) {
    const result = await settings.removeFontDirectory(dir);
    result.match(
      () => toast.success("Font directory removed — reloading fonts…"),
      (err) => toast.error(`Failed to remove font directory: ${err}`),
    );
  }

  function selectUiFont(family: string) {
    settings.setUiFontFamily(family);
    uiFontOpen = false;
    fontFilter = "";
  }

  function selectEditorFont(family: string) {
    settings.setEditorFontFamily(family);
    editorFontOpen = false;
    editorFontFilter = "";
  }

  function selectLightTheme(id: ThemeId) {
    settings.setLightTheme(id);
  }
  function selectDarkTheme(id: ThemeId) {
    settings.setDarkTheme(id);
  }

  function resetSettings() {
    settings.resetToDefaults();
    toast.success("Settings reset to defaults");
  }
</script>

<div class="relative flex h-screen w-screen flex-col overflow-hidden">
  <Titlebar variant="minimal" title="Settings" />

  <div class="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
    <Button variant="ghost" size="sm" class="gap-2" onclick={() => page.back("home")}>
      <HugeiconsIcon icon={ArrowLeft01Icon} class="size-4" />
      Back
    </Button>
    <h1 class="text-base font-semibold">Settings</h1>
    <Button variant="outline" size="sm" class="ml-auto gap-2" onclick={resetSettings}>
      <HugeiconsIcon icon={RefreshIcon} class="size-4" />
      Reset to defaults
    </Button>
  </div>

  <div class="min-h-0 flex-1">
    <ScrollArea.Root class="h-full">
      <div class="mx-auto w-full max-w-3xl px-6 py-8 flex flex-col gap-10">

        <!-- ── Appearance ──────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={PaintBrush01Icon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Appearance
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Pick a palette for each mode. Switch between light and dark from the toggle in the sidebar.
          </p>

          <div class="grid gap-4 md:grid-cols-2">
            <!-- Light theme picker -->
            <div class="rounded-md border border-border p-4">
              <div class="mb-3 flex items-center gap-2">
                <HugeiconsIcon icon={SunIcon} class="size-4" />
                <h3 class="text-sm font-medium">Light mode palette</h3>
              </div>
              <div class="flex flex-col gap-1.5">
                {#each THEMES as theme (theme.id)}
                  <button
                    type="button"
                    class="group flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground {settings.lightTheme === theme.id ? 'bg-accent text-accent-foreground border-border' : ''}"
                    onclick={() => selectLightTheme(theme.id)}
                  >
                    <div
                      class="theme-swatch flex h-6 w-10 shrink-0 rounded border border-border"
                      data-theme={theme.id}
                      aria-hidden="true"
                    >
                      <span class="flex-1 rounded-l" style="background: var(--background)"></span>
                      <span class="flex-1" style="background: var(--primary)"></span>
                      <span class="flex-1 rounded-r" style="background: var(--accent)"></span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium">{theme.label}</p>
                      <p class="truncate text-xs text-muted-foreground">{theme.description}</p>
                    </div>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Dark theme picker -->
            <div class="rounded-md border border-border p-4">
              <div class="mb-3 flex items-center gap-2">
                <HugeiconsIcon icon={Moon02Icon} class="size-4" />
                <h3 class="text-sm font-medium">Dark mode palette</h3>
              </div>
              <div class="flex flex-col gap-1.5">
                {#each THEMES as theme (theme.id)}
                  <button
                    type="button"
                    class="group flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground {settings.darkTheme === theme.id ? 'bg-accent text-accent-foreground border-border' : ''}"
                    onclick={() => selectDarkTheme(theme.id)}
                  >
                    <div
                      class="theme-swatch dark flex h-6 w-10 shrink-0 rounded border border-border"
                      data-theme={theme.id}
                      aria-hidden="true"
                    >
                      <span class="flex-1 rounded-l" style="background: var(--background)"></span>
                      <span class="flex-1" style="background: var(--primary)"></span>
                      <span class="flex-1 rounded-r" style="background: var(--accent)"></span>
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm font-medium">{theme.label}</p>
                      <p class="truncate text-xs text-muted-foreground">{theme.description}</p>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </section>

        <!-- ── Fonts ───────────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={TextFontIcon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Fonts
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Pick fonts for the app interface and the editor. The list includes system fonts plus any
            you've added below.
          </p>

          <div class="flex flex-col gap-4">

            <!-- UI font -->
            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">UI font</p>
                <p class="truncate text-xs text-muted-foreground">
                  Used across the app interface.
                </p>
              </div>
              <Popover.Root bind:open={uiFontOpen}>
                <Popover.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="outline"
                      size="sm"
                      class="min-w-44 justify-between"
                    >
                      <span class="truncate" style="font-family: '{settings.uiFontFamily}', sans-serif">
                        {settings.uiFontFamily}
                      </span>
                    </Button>
                  {/snippet}
                </Popover.Trigger>
                <Popover.Content align="end" class="w-72 p-0">
                  <div class="border-b border-border p-2">
                    <Input
                      placeholder="Search fonts…"
                      bind:value={fontFilter}
                      class="h-8"
                    />
                  </div>
                  <div class="max-h-72 overflow-y-auto py-1">
                    {#if filteredUiFonts.length === 0}
                      <p class="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
                    {:else}
                      {#each filteredUiFonts as family (family)}
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground {settings.uiFontFamily === family ? 'bg-accent/60 text-accent-foreground' : ''}"
                          onclick={() => selectUiFont(family)}
                          style="font-family: '{family}', sans-serif"
                        >
                          <span class="truncate">{family}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                </Popover.Content>
              </Popover.Root>
            </div>

            <!-- Editor font -->
            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Editor font</p>
                <p class="truncate text-xs text-muted-foreground">
                  Monospace font used in the code editor.
                </p>
              </div>
              <Popover.Root bind:open={editorFontOpen}>
                <Popover.Trigger>
                  {#snippet child({ props })}
                    <Button
                      {...props}
                      variant="outline"
                      size="sm"
                      class="min-w-44 justify-between"
                    >
                      <span class="truncate" style="font-family: '{settings.editorFontFamily}', monospace">
                        {settings.editorFontFamily}
                      </span>
                    </Button>
                  {/snippet}
                </Popover.Trigger>
                <Popover.Content align="end" class="w-72 p-0">
                  <div class="border-b border-border p-2">
                    <Input
                      placeholder="Search fonts…"
                      bind:value={editorFontFilter}
                      class="h-8"
                    />
                  </div>
                  <div class="max-h-72 overflow-y-auto py-1">
                    {#if filteredEditorFonts.length === 0}
                      <p class="px-3 py-2 text-xs text-muted-foreground">No matches.</p>
                    {:else}
                      {#each filteredEditorFonts as family (family)}
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground {settings.editorFontFamily === family ? 'bg-accent/60 text-accent-foreground' : ''}"
                          onclick={() => selectEditorFont(family)}
                          style="font-family: '{family}', monospace"
                        >
                          <span class="truncate">{family}</span>
                        </button>
                      {/each}
                    {/if}
                  </div>
                </Popover.Content>
              </Popover.Root>
            </div>

            <!-- Editor font size -->
            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Editor font size</p>
                <p class="truncate text-xs text-muted-foreground">
                  Between 8 and 32 pixels.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="8"
                  max="32"
                  step="1"
                  value={settings.editorFontSize}
                  oninput={(e) =>
                    settings.setEditorFontSize(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-10 text-right text-sm tabular-nums">{settings.editorFontSize}px</span>
              </div>
            </div>

          </div>
        </section>

        <!-- ── Editor behavior ─────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={FileCodeIcon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Editor
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Controls how the code editor renders and behaves while you type.
          </p>

          <div class="flex flex-col gap-3">

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Line numbers</p>
                <p class="truncate text-xs text-muted-foreground">Show a gutter with line numbers.</p>
              </div>
              <Switch
                checked={settings.showLineNumbers}
                onCheckedChange={(v) => settings.setShowLineNumbers(v)}
              />
            </label>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Indentation markers</p>
                <p class="truncate text-xs text-muted-foreground">
                  Faint vertical guides showing indentation levels.
                </p>
              </div>
              <Switch
                checked={settings.showIndentationMarkers}
                onCheckedChange={(v) => settings.setShowIndentationMarkers(v)}
              />
            </label>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Spell check</p>
                <p class="truncate text-xs text-muted-foreground">
                  Underline misspelled words in prose.
                </p>
              </div>
              <Switch
                checked={settings.spellcheck}
                onCheckedChange={(v) => settings.setSpellcheck(v)}
              />
            </label>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Word wrap</p>
                <p class="truncate text-xs text-muted-foreground">
                  Wrap long lines instead of scrolling horizontally.
                </p>
              </div>
              <Switch
                checked={settings.wordWrap}
                onCheckedChange={(v) => settings.setWordWrap(v)}
              />
            </label>

            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Tab width</p>
                <p class="truncate text-xs text-muted-foreground">
                  Number of spaces a tab character represents.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={settings.tabWidth}
                  oninput={(e) => settings.setTabWidth(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-6 text-right text-sm tabular-nums">{settings.tabWidth}</span>
              </div>
            </div>

          </div>
        </section>

        <!-- ── Auto-save ───────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={FloppyDiskIcon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Auto-save
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Save edits to disk after you stop typing. Disable to require a manual save (Ctrl+S).
          </p>

          <div class="flex flex-col gap-3">

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Auto-save when idle</p>
                <p class="truncate text-xs text-muted-foreground">
                  Flush unsaved edits after a pause in typing.
                </p>
              </div>
              <Switch
                checked={settings.autoSaveEnabled}
                onCheckedChange={(v) => settings.setAutoSaveEnabled(v)}
              />
            </label>

            <div
              class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 {settings.autoSaveEnabled ? '' : 'opacity-50'}"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium">Idle delay</p>
                <p class="truncate text-xs text-muted-foreground">
                  How long to wait after the last keystroke before saving.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="250"
                  max="10000"
                  step="250"
                  value={settings.autoSaveDelayMs}
                  disabled={!settings.autoSaveEnabled}
                  oninput={(e) =>
                    settings.setAutoSaveDelayMs(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-16 text-right text-sm tabular-nums">
                  {(settings.autoSaveDelayMs / 1000).toFixed(settings.autoSaveDelayMs % 1000 === 0 ? 0 : 2)}s
                </span>
              </div>
            </div>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Format before saving</p>
                <p class="truncate text-xs text-muted-foreground">
                  Run typstyle on <code>.typ</code> files immediately before each save.
                </p>
              </div>
              <Switch
                checked={settings.formatBeforeSave}
                onCheckedChange={(v) => settings.setFormatBeforeSave(v)}
              />
            </label>

          </div>
        </section>

        <!-- ── Snapshots ───────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={GitCommitIcon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Snapshots
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Typwriter records restore points automatically so you can roll back. Manual restore points
            from the timeline always work regardless of these toggles.
          </p>

          <div class="flex flex-col gap-3">

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Snapshot on save</p>
                <p class="truncate text-xs text-muted-foreground">
                  Record a restore point each time a file is saved.
                </p>
              </div>
              <Switch
                checked={settings.autoSnapshotOnSave}
                onCheckedChange={(v) => settings.setAutoSnapshotOnSave(v)}
              />
            </label>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Snapshot on successful compile</p>
                <p class="truncate text-xs text-muted-foreground">
                  Record a restore point after each successful preview compile.
                </p>
              </div>
              <Switch
                checked={settings.autoSnapshotOnCompile}
                onCheckedChange={(v) => settings.setAutoSnapshotOnCompile(v)}
              />
            </label>

            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Minimum interval between snapshots</p>
                <p class="truncate text-xs text-muted-foreground">
                  Throttle automatic snapshots so they don't fire on every keystroke compile. Set to 0 for no throttle.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="600"
                  step="5"
                  value={settings.autoSnapshotMinIntervalSeconds}
                  oninput={(e) =>
                    settings.setAutoSnapshotMinIntervalSeconds(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-16 text-right text-sm tabular-nums">
                  {settings.autoSnapshotMinIntervalSeconds === 0
                    ? "off"
                    : `${settings.autoSnapshotMinIntervalSeconds}s`}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Keep most recent auto-snapshots</p>
                <p class="truncate text-xs text-muted-foreground">
                  Cap on auto-snapshots from save / compile. Manual restore points and the initial / pre-restore safety points are never pruned. Set to 0 for unlimited.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="500"
                  step="10"
                  value={settings.snapshotRetentionMaxCount}
                  oninput={(e) =>
                    settings.setSnapshotRetentionMaxCount(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-20 text-right text-sm tabular-nums">
                  {settings.snapshotRetentionMaxCount === 0
                    ? "unlimited"
                    : settings.snapshotRetentionMaxCount}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Discard auto-snapshots older than</p>
                <p class="truncate text-xs text-muted-foreground">
                  Maximum age (in days) for auto-snapshots before they're swept on the next snapshot. Manual / initial / pre-restore points are exempt. Set to 0 for unlimited.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="365"
                  step="1"
                  value={settings.snapshotRetentionMaxDays}
                  oninput={(e) =>
                    settings.setSnapshotRetentionMaxDays(parseInt(e.currentTarget.value, 10))}
                  class="w-32 accent-primary"
                />
                <span class="w-20 text-right text-sm tabular-nums">
                  {settings.snapshotRetentionMaxDays === 0
                    ? "unlimited"
                    : `${settings.snapshotRetentionMaxDays}d`}
                </span>
              </div>
            </div>

          </div>
        </section>

        <!-- ── Preview ─────────────────────────────────────────────────── -->
        <section>
          <div class="mb-3 flex items-center gap-2">
            <HugeiconsIcon icon={EyeIcon} class="size-4 text-muted-foreground" />
            <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </h2>
          </div>
          <p class="mb-4 text-sm text-muted-foreground">
            Defaults applied each time you open a workspace.
          </p>

          <div class="flex flex-col gap-3">

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Show preview pane on open</p>
                <p class="truncate text-xs text-muted-foreground">
                  Start the workspace with the preview pane visible.
                </p>
              </div>
              <Switch
                checked={settings.defaultPreviewVisible}
                onCheckedChange={(v) => settings.setDefaultPreviewVisible(v)}
              />
            </label>

            <div class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-medium">Default zoom</p>
                <p class="truncate text-xs text-muted-foreground">
                  Initial zoom applied to the preview on each launch.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0.5"
                  max="4"
                  step="0.25"
                  value={settings.defaultPreviewZoom}
                  oninput={(e) =>
                    settings.setDefaultPreviewZoom(parseFloat(e.currentTarget.value))}
                  class="w-32 accent-primary"
                />
                <span class="w-12 text-right text-sm tabular-nums">
                  {Math.round(settings.defaultPreviewZoom * 100)}%
                </span>
              </div>
            </div>

          </div>
        </section>

        <!-- ── Updates ─────────────────────────────────────────────────── -->
        {#if platform.isDesktop}
          <section>
            <div class="mb-3 flex items-center gap-2">
              <HugeiconsIcon icon={Refresh01Icon} class="size-4 text-muted-foreground" />
              <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Updates
              </h2>
            </div>
            <p class="mb-4 text-sm text-muted-foreground">
              Typwriter can check for new releases when the app starts.
            </p>

            <label class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3 cursor-pointer">
              <div class="min-w-0">
                <p class="text-sm font-medium">Check for updates on launch</p>
                <p class="truncate text-xs text-muted-foreground">
                  Silently look for a new version each time Typwriter starts. You
                  can always check manually from the home screen.
                </p>
              </div>
              <Switch
                checked={settings.autoCheckUpdates}
                onCheckedChange={(v) => settings.setAutoCheckUpdates(v)}
              />
            </label>
          </section>
        {/if}

        <!-- ── Typst font directories ──────────────────────────────────── -->
        <section>
            <div class="mb-3 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <HugeiconsIcon icon={Folder01Icon} class="size-4 text-muted-foreground" />
                <h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Typst font directories
                </h2>
              </div>
              {#if settings.fontsReloading}
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HugeiconsIcon icon={RefreshIcon} class="size-3 animate-spin" />
                  Reloading fonts…
                </span>
              {/if}
            </div>
            <p class="mb-4 text-sm text-muted-foreground">
              {#if platform.isMobile}
                Pick a folder and Typwriter will copy its font files (<code>.ttf</code>, <code>.otf</code>,
                <code>.ttc</code>) into the app's storage so they're available in the editor, the UI
                font pickers above, and in Typst documents. Android scoped storage blocks the font
                scanner from reading shared folders directly.
              {:else}
                Folders scanned for additional font files (<code>.ttf</code>, <code>.otf</code>).
                Fonts found here are available in the editor, the UI font pickers above, and in
                Typst documents.
              {/if}
            </p>

            <div class="rounded-md border border-border">
              {#if settings.fontDirectories.length === 0}
                <p class="px-4 py-6 text-center text-sm text-muted-foreground">
                  No extra font directories. Only system + bundled fonts are loaded.
                </p>
              {:else}
                <ul>
                  {#each settings.fontDirectories as dir, i (dir)}
                    <li
                      class="flex items-center gap-3 px-4 py-2.5 {i > 0 ? 'border-t border-border' : ''}"
                    >
                      <HugeiconsIcon icon={Folder01Icon} class="size-4 shrink-0 text-muted-foreground" />
                      <span class="min-w-0 flex-1 truncate text-sm">{platform.displayPath(dir)}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onclick={() => handleRemoveFontDir(dir)}
                        aria-label="Remove font directory"
                        disabled={settings.fontsReloading}
                      >
                        <HugeiconsIcon icon={Delete01Icon} class="size-4 text-destructive" />
                      </Button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <div class="mt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                class="gap-2"
                onclick={handleAddFontDir}
                disabled={settings.fontsReloading}
              >
                <HugeiconsIcon icon={FolderAddIcon} class="size-4" />
                Add font directory
              </Button>
            </div>
          </section>

      </div>
    </ScrollArea.Root>
  </div>
</div>

<style>
  /* Theme swatches render the variables of a specific preset regardless of
     the document's active theme. They scope the CSS variables to the
     element itself, mirroring the rules in layout.css. */
  .theme-swatch[data-theme="default"] {
    --background: oklch(1 0 0);
    --primary: oklch(0.205 0 0);
    --accent: oklch(0.205 0 0);
  }
  .theme-swatch.dark[data-theme="default"] {
    --background: oklch(0.145 0 0);
    --primary: oklch(0.922 0 0);
    --accent: oklch(0.922 0 0);
  }
  /* Glass shares the default palette; the translucent background bar hints at
     the frosted surfaces this theme applies. */
  .theme-swatch[data-theme="glass"] {
    --background: oklch(1 0 0 / 0.5);
    --primary: oklch(0.205 0 0);
    --accent: oklch(0.205 0 0);
  }
  .theme-swatch.dark[data-theme="glass"] {
    --background: oklch(0.145 0 0 / 0.5);
    --primary: oklch(0.922 0 0);
    --accent: oklch(0.922 0 0);
  }
  .theme-swatch[data-theme="nord"] {
    --background: oklch(0.96 0.01 250);
    --primary: oklch(0.52 0.10 245);
    --accent: oklch(0.62 0.10 200);
  }
  .theme-swatch.dark[data-theme="nord"] {
    --background: oklch(0.30 0.025 252);
    --primary: oklch(0.75 0.08 245);
    --accent: oklch(0.72 0.10 200);
  }
  .theme-swatch[data-theme="dracula"] {
    --background: oklch(0.97 0.01 300);
    --primary: oklch(0.55 0.20 295);
    --accent: oklch(0.65 0.18 340);
  }
  .theme-swatch.dark[data-theme="dracula"] {
    --background: oklch(0.22 0.03 285);
    --primary: oklch(0.78 0.16 295);
    --accent: oklch(0.74 0.18 340);
  }
  .theme-swatch[data-theme="solarized"] {
    --background: oklch(0.96 0.02 85);
    --primary: oklch(0.55 0.13 220);
    --accent: oklch(0.60 0.13 145);
  }
  .theme-swatch.dark[data-theme="solarized"] {
    --background: oklch(0.27 0.02 200);
    --primary: oklch(0.70 0.12 220);
    --accent: oklch(0.72 0.13 145);
  }
  .theme-swatch[data-theme="catppuccin"] {
    --background: oklch(0.97 0.01 320);
    --primary: oklch(0.60 0.16 320);
    --accent: oklch(0.70 0.14 200);
  }
  .theme-swatch.dark[data-theme="catppuccin"] {
    --background: oklch(0.25 0.025 290);
    --primary: oklch(0.78 0.13 320);
    --accent: oklch(0.78 0.12 200);
  }
  .theme-swatch[data-theme="rose-pine"] {
    --background: oklch(0.96 0.01 30);
    --primary: oklch(0.58 0.13 10);
    --accent: oklch(0.62 0.10 190);
  }
  .theme-swatch.dark[data-theme="rose-pine"] {
    --background: oklch(0.26 0.02 320);
    --primary: oklch(0.76 0.11 10);
    --accent: oklch(0.74 0.10 190);
  }
  .theme-swatch[data-theme="gruvbox"] {
    --background: oklch(0.94 0.03 85);
    --primary: oklch(0.50 0.16 30);
    --accent: oklch(0.62 0.16 145);
  }
  .theme-swatch.dark[data-theme="gruvbox"] {
    --background: oklch(0.25 0.02 60);
    --primary: oklch(0.72 0.13 30);
    --accent: oklch(0.74 0.14 145);
  }
</style>
