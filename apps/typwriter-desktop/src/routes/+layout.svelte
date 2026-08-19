<script lang="ts">
  import "./layout.css";
  import { onMount, untrack } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  import { installGlobalErrorLogging } from "$lib/logger";
  import { updater } from "$lib/stores/updater.svelte";
  import { mode, ModeWatcher, setMode, resetMode, setTheme, systemPrefersMode } from "mode-watcher";
  import { app } from "@tauri-apps/api"
  import { Window } from "@tauri-apps/api/window";
  import { settings, type SettingsSyncPayload } from "$lib/stores/settings.svelte";
  import {
    onAppFontsLoaded,
    onSettingsChanged,
    onGrammarConfigChanged,
    onAppModeChanged,
    onShowTutorialRequest,
  } from "$lib/ipc/events";
  import { grammar } from "$lib/stores/grammar.svelte";
  import { snippets } from "$lib/stores/snippets.svelte";
  import { page } from "$lib/stores/page.svelte";
  import { workspace } from "$lib/stores/workspace.svelte";
  import { editor } from "$lib/stores/editor.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { logError } from "$lib/logger";
  import { hasExternalFiles } from "$lib/services/drop-import";

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

  // ── Swallow file drops outside a drop zone ────────────────────────────────
  //
  // The window keeps HTML5 drag-and-drop (`dragDropEnabled: false`), so an
  // unhandled file drop does what a browser does: navigates the WebView to the
  // dropped file, replacing the whole app. The file tree and the editor take
  // the drops they understand and stop propagation; this is the backstop for
  // everywhere else. It only ever calls preventDefault — no import happens
  // from a drop the app didn't ask for.
  $effect(() => {
    if (typeof window === "undefined") return;

    const swallow = (e: DragEvent) => {
      if (!hasExternalFiles(e.dataTransfer)) return;
      e.preventDefault();
      // The drop zones stop propagation before this runs, so reaching here
      // means nothing will take the files — say so with the cursor instead of
      // showing a copy affordance that does nothing.
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };

    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
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
      // keystrokes are mirrored into the store before we persist. Found
      // through the DOM rather than the editor-search store: that store pulls
      // in @codemirror/search, and this layout runs in every window — the
      // settings and diff windows shouldn't parse CodeMirror to close cleanly.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest(".cm-content")) {
        focused.blur();
      }
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

    // Grammar config is per-window state too, and its settings pane is in the
    // settings window while the underlines it controls are in the main one —
    // so every window loads it and every window replays changes to the others.
    grammar.init().mapErr((err) => logError("grammar init failed:", err));
    onGrammarConfigChanged((config) => {
      grammar.applyExternal(config);
    }).mapErr((err) => logError("grammar sync listener failed:", err));

    // Snippets are authored in the settings window and consumed by the editor's
    // completion list in the main one, so every window replays the others'
    // edits. Neither scope arrives on its own: the app-wide set lives in the
    // settings store, and the project file sits in `.typwriter/`, which the
    // workspace watcher ignores.
    void snippets.initSync();

    // Light/dark lives in mode-watcher, not the settings store, so it needs its
    // own replay. Apply locally only — re-emitting would ping-pong.
    onAppModeChanged((next) => {
      if (next === "system") {
        resetMode();
      } else {
        setMode(next);
      }
      app.setTheme(mode.current === "dark" ? "dark" : "light");
    }).mapErr((err) => logError("mode sync listener failed:", err));

    // Settings › General › Tutorial delegates here: only the main window hosts
    // the page stack the onboarding tutorial lives in.
    const currentWindow = Window.getCurrent();
    if (currentWindow.label === "main") {
      onShowTutorialRequest(() => {
        page.navigate("onboarding");
        currentWindow.setFocus().catch((err) => logError("main window focus failed:", err));
      }).mapErr((err) => logError("tutorial request listener failed:", err));
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
