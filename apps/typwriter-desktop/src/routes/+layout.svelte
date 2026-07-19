<script lang="ts">
  import "./layout.css";
  import { onMount, untrack } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher, setTheme, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api"
  import { settings, type SettingsSyncPayload } from "$lib/stores/settings.svelte";
  import { onAppFontsLoaded, onSettingsChanged } from "$lib/ipc/events";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { editorSearch } from "$lib/stores/editor-search.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { logError } from "$lib/logger";

  const { children } = $props();
  let appliedTheme: string | undefined;

  $effect(() => {

    return installGlobalErrorLogging();
  });

  // ── Route external links to the OS browser ────────────────────────────────
  //
  // Anchors with an http(s) href — e.g. the "Open documentation" links inside
  // tinymist LSP hover tooltips (and the typst-ide fallback hovers) — would
  // otherwise navigate the whole WebView away from the app. Intercept them in
  // the capture phase and hand them to the opener plugin instead.
  $effect(() => {
    if (typeof document === "undefined") return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      openUrl(href).catch((err) => logError("open external link failed:", err));
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  });

  // ── Persist + flush before the app is suspended/killed ────────────────────
  //
  // If the OS or window manager tears down the WebView (and the Rust process
  // with it) — a forced quit or crash — none of the in-app flush paths
  // (closeTab / leave / init) run, so unsaved content that lives only in
  // memory would be lost. `visibilitychange → hidden` and `pagehide` are the
  // reliable web-lifecycle signals that fire *before* that teardown.
  $effect(() => {
    if (typeof document === "undefined") return;

    const flush = () => {
      // Force CodeMirror to commit any in-progress IME composition (an IME
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
    app.setTheme(mode.current === "dark" ? "dark" : "light");
    settings.init();

    // `settings.init()` is async, but the persisted value lands on the store
    // synchronously from localStorage before the IPC call, so we can read it
    // here. Skips the network round-trip entirely when the user has opted out.
    if (settings.autoCheckUpdates) {
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

    // Settings live in their own window; replay changes made in any window
    // into this window's store instance so theme/fonts/editor prefs apply
    // everywhere immediately.
    onSettingsChanged<SettingsSyncPayload>((payload) => {
      settings.applyExternal(payload);
    }).mapErr((err) => logError("settings sync listener failed:", err));
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
