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
  } from "@hugeicons/core-free-icons";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import * as Sheet from "$lib/components/ui/sheet";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { pickFontsDir, clearFontsDir, getFontsStatus, getTypstVersion } from "$lib/ipc/commands";

  let pickingFonts = $state(false);
  /** Font families the compiler has loaded, or null before we've asked. */
  let fontFamilies = $state<number | null>(null);
  /** True while a background font load is still running. */
  let fontsLoading = $state(false);

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
  open={app.overlay === "settings"}
  onOpenChange={(o) => {
    if (!o) app.closeOverlay();
  }}
>
  <Sheet.Content side="right" class="w-full max-w-md p-0 sm:max-w-md">
    <div class="flex h-full flex-col" style="padding-top: env(safe-area-inset-top);">
      <div class="flex h-12 items-center border-b px-4">
        <h2 class="text-base font-semibold">Settings</h2>
      </div>
      <ScrollArea class="flex-1">
        <div class="flex flex-col gap-6 p-4">
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
              <Icon icon={TextFontIcon} class="text-muted-foreground size-4" />
              <span class="text-sm font-medium">Fonts folder</span>
            </div>
            <p class="text-muted-foreground text-xs">
              An app-wide folder whose fonts are loaded into the preview. Fonts load in the
              background right after you pick a folder — no restart needed.
            </p>
            {#if settings.fontsDir}
              <div class="bg-muted/50 flex items-center gap-2 rounded-md px-2.5 py-1.5">
                <Icon icon={Folder01Icon} class="text-muted-foreground size-4 shrink-0" />
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
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground text-sm">Version</span>
              <span class="text-sm tabular-nums">{version || "—"}</span>
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
              <Icon icon={GithubIcon} class="size-4" /> GitHub repository
            </button>
            <button
              type="button"
              class="text-muted-foreground active:text-foreground flex items-center gap-2 text-sm"
              onclick={() => openExternal(SPONSOR_URL)}
            >
              <Icon icon={FavouriteIcon} class="size-4" /> Sponsor Typwriter
            </button>
          </section>
        </div>
      </ScrollArea>
    </div>
  </Sheet.Content>
</Sheet.Root>
