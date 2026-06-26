<script lang="ts">
  import { onMount } from "svelte";
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
  import { editor } from "$lib/stores/editor.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  let host = $state<HTMLElement | null>(null);

  onMount(() => {
    if (!host) return;
    const view = createEditorView(host, editor.loadedText, editor.relPath ?? "");
    editor.view = view;
    return () => {
      view.destroy();
      editor.view = null;
    };
  });

  // Reload the document when the open file (or its freshly-read text) changes.
  // Keyed on relPath + loadedText so typing (which changes neither) never
  // re-seeds the buffer.
  $effect(() => {
    const relPath = editor.relPath;
    const text = editor.loadedText;
    const view = editor.view;
    if (!view || editor.fileKind !== "text" || !relPath) return;
    editor.programmatic(() => loadDocInto(view, text, relPath));
  });

  // Theme follows mode-watcher.
  $effect(() => {
    const isDark = mode.current === "dark";
    editor.view?.dispatch({ effects: themeC.reconfigure(themeExtensionFor(isDark)) });
  });

  // Line numbers toggle.
  $effect(() => {
    const show = settings.showLineNumbers;
    editor.view?.dispatch({ effects: lineNumbersC.reconfigure(show ? lineNumbers() : []) });
  });

  // Font size.
  $effect(() => {
    const size = settings.editorFontSize;
    editor.view?.dispatch({ effects: fontSizeC.reconfigure(fontThemeFor(size)) });
  });
</script>

<div bind:this={host} class="h-full min-h-0 w-full overflow-hidden"></div>
