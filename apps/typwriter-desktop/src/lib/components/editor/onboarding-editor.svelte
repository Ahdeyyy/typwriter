<script lang="ts">
  import {
    EditorView,
    keymap,
    drawSelection,
    highlightActiveLine,
  } from "@codemirror/view";
  import { EditorState, Compartment } from "@codemirror/state";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import {
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
  } from "@codemirror/language";
  import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
  import { languages } from "@codemirror/language-data";
  import { untrack } from "svelte";
  import { mode, systemPrefersMode } from "mode-watcher";

  import { typst, light, dark, typstKeymap } from "$lib/typst-codemirror-lang";
  import { settings } from "$lib/stores/settings.svelte";

  /**
   * A deliberately minimal, single-document CodeMirror editor for the tutorial.
   *
   * It has no tabs, no IPC, and no dependency on the `editor` store — the
   * onboarding store owns the shadow-write + recompile flow. This component is
   * purely a controlled text widget:
   *  - `value` is the content to display.
   *  - `seedVersion` is a monotonic counter; whenever it changes the editor
   *    reseeds its document from the *current* `value` (used on step change and
   *    "Reset example"). While the user types, the editor is the source of
   *    truth and reports edits via `onchange` without any reseed.
   */
  interface Props {
    value: string;
    seedVersion: number;
    onchange: (value: string) => void;
  }
  let { value, seedVersion, onchange }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  // Guards the updateListener while we programmatically reseed the document,
  // so a reseed never echoes back through `onchange`.
  let suppress = false;

  const themeCompartment = new Compartment();
  const fontCompartment = new Compartment();

  function resolvedTheme() {
    const m = mode.current;
    const sys = systemPrefersMode.current;
    return m === "dark" || sys === "dark" ? dark : light;
  }

  function fontExtension() {
    const family = settings.editorFontFamily;
    const quoted =
      family.includes(" ") && !family.includes('"') ? `"${family}"` : family;
    return EditorView.theme({
      "&": {
        fontSize: `${settings.editorFontSize}px`,
        fontFamily: `${quoted}, var(--font-mono, monospace)`,
      },
      ".cm-content, .cm-gutters": {
        fontFamily: `${quoted}, var(--font-mono, monospace)`,
      },
    });
  }

  // Create the view once the host is mounted. Everything except the `host`
  // dependency is read untracked so the editor isn't torn down and recreated
  // on every keystroke (value), theme, or font change — those are handled by
  // the reconfigure effects below.
  $effect(() => {
    const el = host;
    if (!el) return;

    const v = untrack(() => new EditorView({
      parent: el,
      state: EditorState.create({
        doc: value,
        extensions: [
          highlightActiveLine(),
          history(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          themeCompartment.of(resolvedTheme()),
          fontCompartment.of(fontExtension()),
          typst({ codeLanguages: languages }),
          // No line-number gutter — the tutorial editor is deliberately bare.
          keymap.of(typstKeymap),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...closeBracketsKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (suppress || !update.docChanged) return;
            onchange(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", width: "100%" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": { paddingLeft: "0.875rem" },
          }),
        ],
      }),
    }));
    view = v;
    return () => {
      v.destroy();
      view = null;
    };
  });

  // Reseed on step change / reset. Tracks `seedVersion` only; reads `value`
  // untracked so per-keystroke value changes don't fight the editor.
  $effect(() => {
    seedVersion;
    untrack(() => {
      const v = view;
      if (!v) return;
      const next = value;
      if (v.state.doc.toString() === next) return;
      suppress = true;
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: next },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
      suppress = false;
    });
  });

  // Reconfigure theme on light/dark change.
  $effect(() => {
    mode.current;
    systemPrefersMode.current;
    const ext = resolvedTheme();
    untrack(() => view?.dispatch({ effects: themeCompartment.reconfigure(ext) }));
  });

  // Reconfigure font on settings change.
  $effect(() => {
    settings.editorFontFamily;
    settings.editorFontSize;
    const ext = fontExtension();
    untrack(() => view?.dispatch({ effects: fontCompartment.reconfigure(ext) }));
  });
</script>

<div bind:this={host} class="h-full w-full overflow-hidden"></div>
