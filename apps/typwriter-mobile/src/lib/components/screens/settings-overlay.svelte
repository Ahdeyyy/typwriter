<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { open } from "@tauri-apps/plugin-dialog";
  import { toast } from "svelte-sonner";
  import { setMode, userPrefersMode } from "mode-watcher";
  import {
    MinusSignIcon,
    PlusSignIcon,
    GithubIcon,
    TextFontIcon,
  } from "@hugeicons/core-free-icons";
  import Icon from "$lib/components/icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import * as Sheet from "$lib/components/ui/sheet";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { app } from "$lib/stores/app.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { setFontsDir } from "$lib/ipc/commands";

  async function chooseFontsFolder() {
    const picked = await open({ directory: true, title: "Choose fonts folder" });
    if (typeof picked !== "string") return;
    void setFontsDir(picked).match(
      () => {
        settings.setFontsDir(picked);
        toast.success("Fonts folder set — restart the app to load the fonts");
      },
      (e) => toast.error(`Failed: ${e}`),
    );
  }

  function clearFontsFolder() {
    void setFontsDir(null).match(
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
              <p class="text-muted-foreground truncate font-mono text-xs">{settings.fontsDir}</p>
            {/if}
            <div class="flex gap-2">
              <Button variant="secondary" size="sm" class="flex-1" onclick={chooseFontsFolder}>
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
