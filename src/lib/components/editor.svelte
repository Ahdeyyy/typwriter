<script lang="ts">
  import { appContext } from "@/app-context.svelte"
  import { typst_completion, typst_hover_tooltip } from "@/editor/typst"
  import { appState } from "@/states.svelte"
  import { saveTextToFile, compile, getFileType } from "@/utils"
  import { yaml } from "@codemirror/lang-yaml"
  import { Compartment, EditorState } from "@codemirror/state"
  import { EditorView, hoverTooltip } from "@codemirror/view"
  import { typst } from "codemirror-lang-typst"

  import { useDebounce } from "runed"
  import { onMount } from "svelte"
  import CodeMirror from "svelte-codemirror-editor"
  import { ayuLight } from "thememirror"
  import Page from "../../routes/+page.svelte"

  // let editor: HTMLElement

  let extensions = $state(new Compartment())

  let documentExtension = $derived.by(() => {
    if (appContext.workspace && appContext.workspace.document) {
      return { ext: getFileType(appContext.workspace.document.path) }
    }
    return { ext: "" }
  })

  let lang = $derived.by(() => {
    switch (documentExtension.ext) {
      case "typ":
        return [typst()]
      case "yaml":
        return [yaml()]
      case "yml":
        return [yaml()]
      default:
        return undefined
    }
  })

  let completion = $derived.by(() => {
    if (documentExtension.ext === "typ") {
      return {
        override: [typst_completion],
        activateOnTyping: true,
      }
    }
    return true
  })

  let languageSpecificExtensions = $derived.by(() => {
    switch (documentExtension.ext) {
      case "typ":
        return [hoverTooltip(typst_hover_tooltip)]
      case "yaml":
        return []
      default:
        return []
    }
  })

  $inspect(lang)
  $inspect(completion)

  onMount(() => {
    console.log("Editor mounted")
  })

  // const debouncedCompile = useDebounce(async (path: string, text: string) => {
  //   await compile(path, text)
  // }, 500)
  // const debouncedSave = useDebounce(async (path: string, text: string) => {
  //   await saveTextToFile(path, text)
  // }, 1000)

  // onMount(() => {
  //   let view = $state<EditorView>(
  //     new EditorView({
  //       state: EditorState.create({
  //         doc: appState.text,
  //         extensions: [
  //           appState.editorExtensions.of([]),
  //           EditorView.updateListener.of(async (v) => {
  //             if (v.docChanged) {
  //               const text = v.state.doc.toString()
  //               if (appState.canCompileFile) {
  //                 await debouncedCompile(appState.currentFilePath, text)
  //               }
  //               await debouncedSave(appState.currentFilePath, text)
  //             }
  //           }),
  //         ],
  //       }),
  //       parent: editor,
  //     })
  //   )
  //   appState.loadEditor(view)
  // })
</script>

<!-- <div bind:this={editor} id="editor"></div> -->

{#if appContext.workspace && appContext.workspace.document}
  <CodeMirror
    bind:value={appContext.workspace.document.content}
    styles={{
      "&": { height: "95svh", width: "100%" },
      ".cm-scroller": { overflow: "auto" },
    }}
    onready={(e) => {
      appContext.editorView = e
    }}
    extensions={languageSpecificExtensions}
    lang={lang ? lang[0] : undefined}
    theme={ayuLight}
    lineWrapping
    lineNumbers
    autocompletion={completion}
    foldGutter
  />
{/if}
