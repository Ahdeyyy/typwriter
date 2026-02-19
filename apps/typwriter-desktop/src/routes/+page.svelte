<script lang="ts">
  import { EditorState } from "@codemirror/state"
  import { basicSetup } from "codemirror"
  import { EditorView, keymap } from "@codemirror/view"
  import { indentWithTab } from "@codemirror/commands"
  import { typstLanguage, typst } from "../lib/typst-codemirror-lang/index"
  import { onMount } from "svelte"
  import { githubLightHighlightStyle } from "$lib/typst-codemirror-lang/lightTheme"
  import { syntaxHighlighting } from "@codemirror/language"
  import { tokyoNightDarkHighlightStyle } from "$lib/typst-codemirror-lang/darkTheme"

  let editorElement: HTMLDivElement
  let view: EditorView | null

  $effect(() => {
    if (!editorElement || view) return
    const state = EditorState.create({
      doc: "Start document",
      extensions: [
        basicSetup,
        typst(),
        keymap.of([indentWithTab]),
        syntaxHighlighting(tokyoNightDarkHighlightStyle),
      ],
    })
    view = new EditorView({
      state,
      parent: editorElement,
    })

    return () => {
      view?.destroy()
      view = null
    }
  })
</script>

<div class="editor-container" bind:this={editorElement}></div>

<style>
  .editor-container {
    height: 100%;
    width: 100%;
    border: 1px solid #ccc;
    text-align: left; /* Reset text align */
  }
</style>
