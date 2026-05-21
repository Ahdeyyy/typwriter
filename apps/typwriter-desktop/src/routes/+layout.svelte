<script lang="ts">
  import "./layout.css";
  import "@fontsource-variable/inter/wght.css";
  import { onMount, untrack } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher, setTheme, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api"
  import { platform } from "$lib/stores/platform.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { onAppFontsLoaded } from "$lib/ipc/events";

  const { children } = $props();
  let appliedTheme: string | undefined;

  $effect(() => {

    return installGlobalErrorLogging();
  });

  onMount(async () => {
    if (platform.isDesktop) {
      app.setTheme(mode.current === "dark" ? "dark" : "light");
    }
    settings.init().andThen(() => settings.refreshFontFamilies());

    // `settings.init()` is async, but the persisted value lands on the store
    // synchronously from localStorage before the IPC call, so we can read it
    // here. Skips the network round-trip entirely when the user has opted
    // out. tauri-plugin-updater is desktop-only — the lib.rs setup gates it
    // by `cfg(not(any(target_os = "android", target_os = "ios")))`, so calling
    // `updater.checkPassive` on mobile would only produce a failed IPC.
    if (platform.isDesktop && settings.autoCheckUpdates) {
      updater.checkPassive();
    }

    // Background font reloads (settings change) replay the same event the
    // initial startup load uses; refresh the family list when they land.
    const result = await onAppFontsLoaded(() => {
      settings.onFontsReloaded();
    });
    if (result.isErr()) {
      // Logged inside onAppFontsLoaded helper if needed; no-op here.
    }
  });

  // ── Apply settings to <html> reactively ──────────────────────────────────
  function quote(family: string): string {
    const escaped = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `"${escaped}"`;
  }

  $effect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const effectiveMode = mode.current ?? systemPrefersMode.current;
    const activeTheme =
      effectiveMode === "dark" ? settings.darkTheme : settings.lightTheme;
    if (activeTheme !== appliedTheme) {
      appliedTheme = activeTheme;
      untrack(() => setTheme(activeTheme));
    }
    root.setAttribute("data-theme", activeTheme);
    root.style.setProperty("--app-font-sans", `${quote(settings.uiFontFamily)}, sans-serif`);
    root.style.setProperty("--font-heading", `${quote(settings.uiFontFamily)}, sans-serif`);
    root.style.setProperty(
      "--font-mono",
      `${quote(settings.editorFontFamily)}, ui-monospace, "SFMono-Regular", Menlo, monospace`
    );
    root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  });
</script>

<Toaster position="top-right" />
<ModeWatcher />
{@render children()}
