<script lang="ts">
  import { onMount } from "svelte";
  import { watch } from "runed";
  import { mode } from "mode-watcher";
  import { lineNumbers } from "@codemirror/view";
  import {
    createEditorView,
    loadDocInto,
    themeC,
    lineNumbersC,
    fontSizeC,
    themeExtensionFor,
    fontThemeFor,
  } from "$lib/editor/create-editor";
  import {
    setInlineDiagnostics,
    type InlineDiagnostic,
  } from "$lib/editor/inline-diagnostics";
  import { editor } from "$lib/stores/editor.svelte";
  import { settings } from "$lib/stores/settings.svelte";
  import { compileStore } from "$lib/stores/compile.svelte";
  import { completions } from "$lib/editor/completion-controller.svelte";

  let host = $state<HTMLElement | null>(null);

  onMount(() => {
    if (!host) return;
    const relPath = editor.relPath;
    const view = createEditorView(host, editor.loadedText, relPath ?? "");
    editor.view = view;
    const cursor = editor.relPath ? editor.takePendingCursor(editor.relPath) : null;
    if (cursor !== null) {
      editor.programmatic(() => loadDocInto(view, editor.loadedText, editor.relPath!, cursor));
    }
    return () => {
      // A history/back transition may unmount while a save is still draining.
      // Keep the seed current if this screen is mounted again before it ends.
      if (editor.relPath === relPath && !editor.loading && editor.fileKind === "text") {
        editor.loadedText = view.state.doc.toString();
      }
      completions.clear();
      view.destroy();
      editor.view = null;
    };
  });

  // Every watcher below drives CodeMirror, and everything they touch — building
  // the extension set, dispatching a transaction — runs plugin code that reads
  // stores of its own (`caret-visibility` reads `keyboard.visible`). Read inside
  // an effect, those become dependencies of that effect. `watch` tracks only
  // its source getters, keeping keyboard and cursor changes out of the sync.
  // File loads remount this host; disk refreshes update the live view with a
  // minimal change in the store. Watching loadedText here would replace that
  // carefully mapped selection and reset the undo history a second time.

  // Theme follows mode-watcher.
  watch([() => editor.view, () => mode.current === "dark"], ([view, isDark]) => {
    view?.dispatch({ effects: themeC.reconfigure(themeExtensionFor(isDark)) });
  });

  // Line numbers toggle.
  watch([() => editor.view, () => settings.showLineNumbers], ([view, show]) => {
    view?.dispatch({ effects: lineNumbersC.reconfigure(show ? lineNumbers() : []) });
  });

  // Font size.
  watch([() => editor.view, () => settings.editorFontSize], ([view, size]) => {
    view?.dispatch({ effects: fontSizeC.reconfigure(fontThemeFor(size)) });
  });

  // Inline diagnostics: project the compile store's errors/warnings for the
  // active file into the editor as end-of-line chips. Re-runs after every
  // compile and on file switch (relPath), after the view has been created.
  watch(
    [
      () => editor.view,
      () => editor.relPath,
      () => [...compileStore.errors, ...compileStore.warnings],
    ],
    ([view, relPath, all]) => {
      if (!view || editor.fileKind !== "text" || !relPath) return;
      const diags: InlineDiagnostic[] = all
        .filter((d) => d.filePath === relPath && d.range !== null)
        .map((d) => ({
          line: d.range!.startLine,
          severity: d.severity,
          message: d.message,
        }));
      view.dispatch({ effects: setInlineDiagnostics.of(diags) });
    },
  );
</script>

<div bind:this={host} class="h-full min-h-0 w-full overflow-hidden"></div>
