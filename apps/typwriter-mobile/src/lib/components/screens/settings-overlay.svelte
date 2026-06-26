<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { toast } from "svelte-sonner";
  import { setMode, userPrefersMode } from "mode-watcher";
  import {
    MinusSignIcon,
    PlusSignIcon,
    GithubIcon,
    TextFontIcon,
    Folder01Icon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import * as Sheet from "$lib/components/ui/sheet";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { pickFontsDir, clearFontsDir } from "$lib/ipc/commands";

  let pickingFonts = $state(false);

  function chooseFontsFolder() {
    if (pickingFonts) return;
    pickingFonts = true;
    void pickFontsDir().match(
      (name) => {
        pickingFonts = false;
        if (name === null) return; // cancelled
        settings.setFontsDir(name);
        toast.success("Fonts folder set — restart the app to load the fonts");
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
        toast.success("Fonts folder cleared — restart to apply");
      },
      (e) => toast.error(`Failed: ${e}`),
    );
  }

  let version = $state("");
  onMount(() => {
    getVersion().then((v) => (version = v)).catch(() => {});
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
          <!-- Theme -->
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

          <!-- Editor font size -->
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

          <!-- Line numbers -->
          <section class="flex items-center justify-between">
            <span class="text-sm font-medium">Line numbers</span>
            <Switch
              checked={settings.showLineNumbers}
              onCheckedChange={(v) => settings.setShowLineNumbers(v)}
            />
          </section>

          <!-- Autosave -->
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

          <!-- Preview sharpness -->
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

          <!-- Fonts folder (app-wide font source) -->
          <section class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <Icon icon={TextFontIcon} class="text-muted-foreground size-4" />
              <span class="text-sm font-medium">Fonts folder</span>
            </div>
            <p class="text-muted-foreground text-xs">
              An app-wide folder whose fonts are loaded into the preview. Applied on the next
              app launch.
            </p>
            {#if settings.fontsDir}
              <div class="bg-muted/50 flex items-center gap-2 rounded-md px-2.5 py-1.5">
                <Icon icon={Folder01Icon} class="text-muted-foreground size-4 shrink-0" />
                <span class="truncate text-xs">{settings.fontsDir}</span>
              </div>
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

          <!-- About -->
          <section class="flex flex-col gap-2 border-t pt-4">
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground text-sm">Version</span>
              <span class="text-sm tabular-nums">{version || "—"}</span>
            </div>
            <a
              href="https://github.com/Ahdeyyy/typwriter"
              target="_blank"
              rel="noreferrer"
              class="text-muted-foreground active:text-foreground flex items-center gap-2 text-sm"
            >
              <Icon icon={GithubIcon} class="size-4" /> GitHub repository
            </a>
          </section>
        </div>
      </ScrollArea>
    </div>
  </Sheet.Content>
</Sheet.Root>
