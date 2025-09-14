<script lang="ts">
  import { app } from "@/states.svelte"
  import { saveTextToFile, compile } from "@/utils"
  import { EditorState } from "@codemirror/state"
  import { EditorView } from "@codemirror/view"
  import { basicSetup } from "codemirror"
  import { useDebounce } from "runed"
  import { onMount } from "svelte"

  let editor: HTMLElement

  const debouncedCompile = useDebounce(async (text: string) => {
    await compile(text)
  }, 500)
  const debouncedSave = useDebounce(async (text: string) => {
    await saveTextToFile(text)
  }, 1000)

  onMount(() => {
    const fixedHeight = EditorView.theme({
      "&": { height: "92svh" },
      ".cm-scroller": { overflow: "auto" },
    })

    const editorWidth = EditorView.theme({
      "&": { width: "100%" },
    })
    let view = $state<EditorView>(
      new EditorView({
        state: EditorState.create({
          doc: app.text,
          extensions: [
            EditorView.lineWrapping,
            fixedHeight,
            editorWidth,
            basicSetup,
            EditorView.updateListener.of((v) => {
              if (v.docChanged) {
                const text = v.state.doc.toString()
                debouncedCompile(text)
                debouncedSave(text)
              }
            }),
          ],
        }),
        parent: editor,
      })
    )
    app.loadEditor(view)
  })

  // $effect(() => {
  //   let { text, currentFilePath } = app
  //   console.log("App text changed:", text)
  //   console.log("Current file path:", currentFilePath)
  //   // use the current file path to get the the file extension, and set the language accordingly
  //   const tr = view.state.update({
  //     changes: {
  //       from: 0,
  //       to: view.state.doc.length,
  //       insert: text,
  //     },
  //     // This is an important step to prevent the change from being merged with
  //     // the previous undo history. Setting a user event prevents this.
  //     userEvent: "replace-document",
  //   })
  //   console.log("Text changed, updating editor")
  //   view.dispatch(tr)
  // })
</script>

<div bind:this={editor} id="editor"></div>
