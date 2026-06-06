<script lang="ts">
  import "./layout.css";
  import { onMount, untrack } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher, setTheme, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api"
  import { platform } from "$lib/stores/platform.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { onAppFontsLoaded } from "$lib/ipc/events";
  import { installKeyboardAvoider } from "$lib/hooks/mobile-keyboard";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { editorSearch } from "$lib/stores/editor-search.svelte";

  const { children } = $props();
  let appliedTheme: string | undefined;

  $effect(() => {

    return installGlobalErrorLogging();
  });

  $effect(() => {
    // No-op on desktop. Keeps focused inputs above the soft keyboard on
    // Android by listening to visualViewport changes.
    return installKeyboardAvoider();
  });

  // ── Persist + flush before the app is suspended/killed ────────────────────
  //
  // On mobile the OS can tear down the WebView (and the Rust process with it)
  // the moment the app is backgrounded — none of the in-app flush paths
  // (closeTab / leave / init) run, so unsaved content that lives only in
  // memory would be lost. `visibilitychange → hidden` and `pagehide` are the
  // reliable web-lifecycle signals that fire *before* that teardown.
  $effect(() => {
    if (typeof document === "undefined") return;

    const flush = () => {
      // Force CodeMirror to commit any in-progress IME composition (Gboard
      // composes a word before it lands in the document) so the latest
      // keystrokes are mirrored into the store before we persist.
      editorSearch.getActiveView()?.contentDOM.blur();
      // Snapshot the (now durable) unsaved buffers, then save dirty tabs to
      // disk. persistTabs is synchronous up to the IPC call; flushAllTabs is
      // best-effort — if the OS suspends mid-flush, the durable snapshot from
      // persistTabs still covers us via hot-exit restore.
      workspace.persistTabs();
      void editor.flushAllTabs();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  });

  onMount(async () => {
    if (platform.isDesktop) {
      app.setTheme(mode.current === "dark" ? "dark" : "light");
    }
    settings.init();

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
