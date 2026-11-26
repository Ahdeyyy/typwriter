<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { ResultAsync } from "neverthrow";
  import { getVersion } from "@tauri-apps/api/app";
  import { toast } from "svelte-sonner";
  import { setMode, userPrefersMode } from "mode-watcher";
  import {
    MinusSignIcon,
    PlusSignIcon,
    GithubIcon,
    TextFontIcon,
    Folder01Icon,
    FavouriteIcon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    File02Icon,
    BookOpen01Icon,
  } from "@hugeicons/core-free-icons";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Icon from "#lib/components/icon.svelte";
  import { Button } from "#lib/components/ui/button/index.ts";
  import { Switch } from "#lib/components/ui/switch/index.ts";
  import * as Sheet from "#lib/components/ui/sheet/index.ts";
  import { ScrollArea } from "#lib/components/ui/scroll-area/index.ts";
  import { app } from "#lib/stores/app.svelte.ts";
  import { settings } from "#lib/stores/settings.svelte.ts";
  import { spell } from "#lib/stores/spell.svelte.ts";
  import { updater, type UpdateStatus } from "#lib/stores/updater.svelte.ts";
  import { pickFontsDir, clearFontsDir, getFontsStatus, getTypstVersion } from "#lib/ipc/commands.ts";
  import LicensesScreen from "./licenses-screen.svelte";
  import DictionaryScreen from "./dictionary-screen.svelte";

  /** Settings' sub-screens: they share the sheet and go back to settings. */
  const subScreenTitles: Partial<Record<typeof app.overlay, string>> = {
    licenses: "Open-source licenses",
    dictionary: "Your dictionary",
  };
  const subScreenTitle = $derived(subScreenTitles[app.overlay]);

  const spellSource = $derived(
    spell.deviceGrammar === true
      ? "Spelling from the built-in English dictionary, grammar from your keyboard"
      : spell.deviceGrammar === false
        ? "Spelling from the built-in English dictionary — your keyboard doesn't check grammar here"
        : "Spelling from the built-in English dictionary, grammar from your keyboard when it can",
  );

  let pickingFonts = $state(false);
  /** Font families the compiler has loaded, or null before we've asked. */
  let fontFamilies = $state<number | null>(null);
  /** True while a background font load is still running. */
  let fontsLoading = $state(false);
  let viewportHeight = $state("100%");
  let viewportTop = $state(0);

  onMount(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
      viewportTop = Math.max(0, Math.round(viewport.offsetTop));
      viewportHeight = `${Math.min(layoutHeight, Math.round(viewport.height) + viewportTop)}px`;
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  });

  /** How long to keep following a background load before giving up on it. */
  const FONT_POLL_MS = 500;
  const FONT_POLL_TIMEOUT_MS = 60_000;
  let fontPoll: ReturnType<typeof setTimeout> | null = null;

  /** Pull the folder + font count from the backend, which is the only place
   *  that knows what actually loaded. */
  function refreshFontsStatus(): ResultAsync<boolean, string> {
    return getFontsStatus().map((status) => {
      settings.setFontsDir(status.folder);
      fontFamilies = status.familyCount;
      fontsLoading = status.loading;
      return status.loading;
    });
  }

  /**
   * Follow a background font load to completion.
   *
   * The load's slow case — a large SAF tree, one read per file — is exactly the
   * one users come to this screen to diagnose, so a fixed delay would report the
   * pre-load count and read as "the folder was empty".
   */
  function trackFontLoad(deadline = Date.now() + FONT_POLL_TIMEOUT_MS) {
    if (fontPoll) clearTimeout(fontPoll);
    fontPoll = setTimeout(() => {
      fontPoll = null;
      void refreshFontsStatus().map((loading) => {
        if (loading && Date.now() < deadline) trackFontLoad(deadline);
      });
    }, FONT_POLL_MS);
  }

  function chooseFontsFolder() {
    if (pickingFonts) return;
    pickingFonts = true;
    void pickFontsDir().match(
      (name) => {
        pickingFonts = false;
        if (name === null) return; // cancelled
        settings.setFontsDir(name);
        toast.success("Fonts folder set — loading fonts in the background");
        fontsLoading = true;
        trackFontLoad();
      },
      (e) => {
        pickingFonts = false;
        toast.error(`Failed: ${e}`);
      },
    );
  }

  function clearFontsFolder() {
    void clearFontsDir().match(
      () => {
        settings.setFontsDir(null);
        toast.success("Fonts folder cleared");
        fontsLoading = true;
        trackFontLoad();
      },
      (e) => toast.error(`Failed: ${e}`),
    );
  }

  onDestroy(() => {
    if (fontPoll) clearTimeout(fontPoll);
  });

  const REPO_URL = "https://github.com/Ahdeyyy/typwriter";
  // Matches the `github:` entry in the repo's .github/FUNDING.yml.
  const SPONSOR_URL = "https://github.com/sponsors/Ahdeyyy";

  // The Android WebView won't hand a `target="_blank"` link to the system
  // browser, so external links go through the opener plugin instead.
  function openExternal(url: string) {
    openUrl(url).catch(() => toast.error("Couldn't open the link"));
  }

  let version = $state("");
  let typstVersion = $state("");

  const updateLabel: Record<UpdateStatus, string> = {
    idle: "Check for updates",
    checking: "Checking…",
    "up-to-date": "Up to date · Check again",
    available: "Check for updates",
    failed: "Check failed · Retry",
  };
  onMount(() => {
    getVersion().then((v) => (version = v)).catch(() => {});
    // The Typst release this build compiles with — the same value documents see
    // as `sys.version`, read from the compiler rather than hardcoded here.
    void getTypstVersion().map((v) => (typstVersion = v));
    // The backend's persisted source is the truth for the fonts folder — sync
    // the display so a stale/failed frontend store can never show the wrong
    // state after a restart.
    void refreshFontsStatus().map((loading) => {
      // Opening settings while the startup load is still running: follow it in
      // rather than leaving the embedded-only count on screen as if it were final.
      if (loading) trackFontLoad();
    });
  });

  const themes = [
    { label: "Light", value: "light" as const },
    { label: "Dark", value: "dark" as const },
    { label: "System", value: "system" as const },
  ];
  const autosaveOptions = [
    { label: "300 ms", value: 300 },
    { label: "600 ms", value: 600 },
    { label: "1 s", value: 1000 },
  ];
  const sharpnessOptions = [
    { label: "Battery", value: 2 as const },
    { label: "Balanced", value: 3 as const },
    { label: "Crisp", value: 4 as const },
  ];
</script>

<Sheet.Root
  open={app.overlay === "settings" || subScreenTitle !== undefined}
  onOpenChange={(o) => {
    if (!o) app.closeOverlay();
  }}
>
  <Sheet.Content side="right" class="w-full max-w-md p-0 data-[side=right]:w-full sm:max-w-md"
    showCloseButton={subScreenTitle === undefined}
    style={`height: var(--app-height, ${viewportHeight});`}>
    <div class="flex h-full min-h-0 flex-col"
      style={`padding-top: calc(${viewportTop}px + var(--safe-top));`}>
      <div class="flex h-12 shrink-0 items-center border-b px-4">
        {#if subScreenTitle}
          <Button variant="ghost" size="icon-sm" class="mr-2" aria-label="Back to settings" onclick={() => app.closeOverlay()}>
            <Icon icon={ArrowLeft01Icon} />
          </Button>
        {/if}
        <Sheet.Title class="text-base font-semibold">{subScreenTitle ?? "Settings"}</Sheet.Title>
      </div>
      <Sheet.Description class="sr-only">App preferences and third-party software notices.</Sheet.Description>
      {#if app.overlay === "licenses"}
        <LicensesScreen />
      {:else if app.overlay === "dictionary"}
        <DictionaryScreen />
      {:else}
      <ScrollArea class="min-h-0 flex-1">
        <!-- The sheet runs behind the navigation bar (edge to edge); the last row
             has to scroll clear of it. -->
        <div class="flex flex-col gap-6 p-4" style="padding-bottom: calc(var(--safe-bottom) + 1.5rem);">
          <section class="flex flex-col gap-2">
            <span class="text-sm font-medium">Theme</span>
            <div class="grid grid-cols-3 gap-1">
              {#each themes as t (t.value)}
                <Button
                  variant={userPrefersMode.current === t.value ? "default" : "secondary"}
                  size="sm"
                  onclick={() => setMode(t.value)}
                >
                  {t.label}
                </Button>
              {/each}
            </div>
          </section>

          <section class="flex items-center justify-between">
            <span class="text-sm font-medium">Editor font size</span>
            <div class="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Smaller"
                onclick={() => settings.setEditorFontSize(settings.editorFontSize - 1)}
              >
                <Icon icon={MinusSignIcon} />
              </Button>
              <span class="w-8 text-center text-sm tabular-nums">{settings.editorFontSize}</span>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Larger"
                onclick={() => settings.setEditorFontSize(settings.editorFontSize + 1)}
              >
                <Icon icon={PlusSignIcon} />
              </Button>
            </div>
          </section>

          <section class="flex items-center justify-between">
            <span class="text-sm font-medium">Line numbers</span>
            <Switch
              checked={settings.showLineNumbers}
              onCheckedChange={(v) => settings.setShowLineNumbers(v)}
            />
          </section>

          <section class="flex items-center justify-between">
            <span class="text-sm font-medium">Inline title</span>
            <Switch
              checked={settings.showInlineTitle}
              onCheckedChange={(v) => settings.setShowInlineTitle(v)}
            />
          </section>

          <section class="flex items-center justify-between gap-4">
            <div class="flex flex-col">
              <span class="text-sm font-medium">Hide controls while scrolling</span>
              <span class="text-muted-foreground text-xs">Also hides the status bar for distraction-free reading</span>
            </div>
            <Switch
              checked={settings.hideChromeOnScroll}
              onCheckedChange={(v) => settings.setHideChromeOnScroll(v)}
            />
          </section>

          <section class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-4">
              <div class="flex flex-col">
                <span class="text-sm font-medium">Spell check</span>
                <span class="text-muted-foreground text-xs">{spellSource}</span>
              </div>
              <Switch
                checked={settings.spellcheck}
                onCheckedChange={(v) => settings.setSpellcheck(v)}
              />
            </div>
            {#if settings.spellcheck && settings.spellIgnoredWords.length > 0}
              <!-- A row, not the words themselves: the list grows without bound
                   and would push every setting below it off the screen. -->
              <button
                type="button"
                class="flex min-h-11 items-center gap-2 rounded-md text-left text-sm focus-visible:outline-ring"
                onclick={() => app.openOverlay("dictionary")}
              >
                <Icon icon={BookOpen01Icon} class="text-muted-foreground size-5" />
                <span class="flex-1">Your dictionary</span>
                <span class="text-muted-foreground text-sm tabular-nums">
                  {settings.spellIgnoredWords.length}
                  {settings.spellIgnoredWords.length === 1 ? "word" : "words"}
                </span>
                <Icon icon={ArrowRight01Icon} class="text-muted-foreground size-5" />
              </button>
            {/if}
          </section>

          <section class="flex flex-col gap-2">
            <span class="text-sm font-medium">Autosave delay</span>
            <div class="grid grid-cols-3 gap-1">
              {#each autosaveOptions as opt (opt.value)}
                <Button
                  variant={settings.autosaveMs === opt.value ? "default" : "secondary"}
                  size="sm"
                  onclick={() => settings.setAutosaveMs(opt.value)}
                >
                  {opt.label}
                </Button>
              {/each}
            </div>
          </section>

          <section class="flex flex-col gap-2">
            <span class="text-sm font-medium">Preview sharpness</span>
            <div class="grid grid-cols-3 gap-1">
              {#each sharpnessOptions as opt (opt.value)}
                <Button
                  variant={settings.previewScaleBucket === opt.value ? "default" : "secondary"}
                  size="sm"
                  onclick={() => settings.setPreviewScaleBucket(opt.value)}
                >
                  {opt.label}
                </Button>
              {/each}
            </div>
          </section>

          <section class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <Icon icon={TextFontIcon} class="text-muted-foreground size-5" />
              <span class="text-sm font-medium">Fonts folder</span>
            </div>
            <p class="text-muted-foreground text-xs">
              An app-wide folder whose fonts are loaded into the preview. Fonts load in the
              background right after you pick a folder — no restart needed.
            </p>
            {#if settings.fontsDir}
              <div class="bg-muted/50 flex items-center gap-2 rounded-md px-2.5 py-1.5">
                <Icon icon={Folder01Icon} class="text-muted-foreground size-5 shrink-0" />
                <span class="truncate text-xs">{settings.fontsDir}</span>
              </div>
            {/if}
            {#if fontsLoading}
              <p class="text-muted-foreground text-xs">Loading fonts…</p>
            {:else if fontFamilies !== null}
              <p class="text-muted-foreground text-xs tabular-nums">
                {fontFamilies} font {fontFamilies === 1 ? "family" : "families"} available
              </p>
            {/if}
            <div class="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                class="flex-1"
                disabled={pickingFonts}
                onclick={chooseFontsFolder}
              >
                {settings.fontsDir ? "Change folder" : "Choose folder"}
              </Button>
              {#if settings.fontsDir}
                <Button variant="ghost" size="sm" onclick={clearFontsFolder}>Clear</Button>
              {/if}
            </div>
          </section>

          <section class="flex flex-col gap-2 border-t pt-4">
            <button
              type="button"
              class="flex min-h-11 items-center gap-2 rounded-md text-left text-sm focus-visible:outline-ring"
              onclick={() => app.openOverlay("licenses")}
            >
              <Icon icon={File02Icon} class="text-muted-foreground size-5" />
              <span class="flex-1">Open-source licenses</span>
              <Icon icon={ArrowRight01Icon} class="text-muted-foreground size-5" />
            </button>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground text-sm">Version</span>
              <span class="text-sm tabular-nums">{version || "—"}</span>
            </div>
            <div class="flex min-h-11 items-center justify-between gap-2">
              <span class="text-muted-foreground text-sm">Updates</span>
              {#if updater.status === "available" && updater.update}
                <Button size="sm" onclick={() => updater.download()}>
                  Download {updater.update.version}
                </Button>
              {:else}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={updater.status === "checking"}
                  onclick={() => void updater.check()}
                >
                  {updateLabel[updater.status]}
                </Button>
              {/if}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground text-sm">Typst</span>
              <span class="text-sm tabular-nums">{typstVersion ? `v${typstVersion}` : "—"}</span>
            </div>
            <button
              type="button"
              class="text-muted-foreground active:text-foreground flex items-center gap-2 text-sm"
              onclick={() => openExternal(REPO_URL)}
            >
              <Icon icon={GithubIcon} class="size-5" /> GitHub repository
            </button>
            <button
              type="button"
              class="text-muted-foreground active:text-foreground flex items-center gap-2 text-sm"
              onclick={() => openExternal(SPONSOR_URL)}
            >
              <Icon icon={FavouriteIcon} class="size-5" /> Sponsor Typwriter
            </button>
          </section>
        </div>
      </ScrollArea>
      {/if}
    </div>
  </Sheet.Content>
</Sheet.Root>
